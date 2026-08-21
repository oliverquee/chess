/**
 * Laptop-side Stockfish analysis backfill.
 * Depth 16 analysis with depth 8 capture for human-findability filtering.
 * High-throughput parallel pipelining, resumable across database interruptions.
 */

import { fork } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { Chess } from 'chess.js';
import { initDb, updateMoveAnalysis, updateGameAnalysisStatus } from '../storage/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = resolve('storage/analyst.db');
const WORKER_PATH = resolve(__dirname, '../engine/stockfishForkWorker.js');
const ANALYSIS_DEPTH = 16;
const NUM_WORKERS = Math.max(4, cpus().length - 2);
const CONCURRENT_GAMES = 16;

class ForkedStockfishPool {
  constructor(size = NUM_WORKERS) {
    this.size = size;
    this.workers = [];
    this.idleWorkers = [];
    this.pendingTasks = new Map();
    this.taskId = 0;
    this.queue = [];
  }

  async init() {
    const readyPromises = [];
    for (let i = 0; i < this.size; i += 1) {
      const child = fork(WORKER_PATH);
      const readyPromise = new Promise((resolveReady, rejectReady) => {
        const onMsg = (msg) => {
          if (msg.type === 'ready') {
            child.removeListener('message', onMsg);
            resolveReady();
          } else if (msg.type === 'fatal') {
            rejectReady(new Error(msg.error));
          }
        };
        child.on('message', onMsg);
        child.once('error', rejectReady);
      });
      readyPromises.push(readyPromise);

      child.on('message', (msg) => {
        if (msg.type === 'result' || msg.type === 'error') {
          const task = this.pendingTasks.get(msg.id);
          if (task) {
            this.pendingTasks.delete(msg.id);
            if (msg.type === 'result') task.resolve(msg.result);
            else task.reject(new Error(msg.error));
          }
          this.idleWorkers.push(child);
          this.drain();
        }
      });

      this.workers.push(child);
      this.idleWorkers.push(child);
    }
    await Promise.all(readyPromises);
  }

  drain() {
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const child = this.idleWorkers.shift();
      const task = this.queue.shift();
      const id = ++this.taskId;
      this.pendingTasks.set(id, task);
      child.send({ type: 'analyze', id, fen: task.fen, depth: task.depth });
    }
  }

  analyze(fen, depth = ANALYSIS_DEPTH) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, resolve, reject });
      this.drain();
    });
  }

  close() {
    for (const child of this.workers) {
      child.send({ type: 'quit' });
      setTimeout(() => child.kill(), 1000);
    }
  }
}

async function analyzeSingleGame(db, game, getEval) {
  const gameMoves = db.prepare(`
    SELECT id, ply_number, fen_before, move_played
    FROM moves
    WHERE game_id = ?
    ORDER BY ply_number ASC
  `).all(game.id);

  if (gameMoves.length === 0) {
    updateGameAnalysisStatus(db, game.id, {
      status: 'analyzed',
      analysis_engine: 'Stockfish 18 Lite WASM',
      analysis_depth: ANALYSIS_DEPTH,
    });
    return 0;
  }

  // Schedule all move position evaluations
  const evalPromises = [];
  for (let i = 0; i < gameMoves.length; i += 1) {
    const move = gameMoves[i];
    const beforePromise = getEval(move.fen_before);

    let afterFen;
    if (i + 1 < gameMoves.length) {
      afterFen = gameMoves[i + 1].fen_before;
    } else {
      const c = new Chess(move.fen_before);
      c.move(move.move_played);
      afterFen = c.fen();
    }
    const afterPromise = getEval(afterFen);
    evalPromises.push({ move, beforePromise, afterPromise });
  }

  const results = [];
  for (const item of evalPromises) {
    const beforeEval = await item.beforePromise;
    const afterEval = await item.afterPromise;
    results.push({ move: item.move, before: beforeEval, after: afterEval });
  }

  // Atomic write in single transaction
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of results) {
      updateMoveAnalysis(db, item.move.id, {
        eval_cp_before: item.before.evalCp,
        eval_cp_after: item.after.evalCp,
        best_move: item.before.bestMove,
        best_move_depth8: item.before.bestMoveDepth8,
        principal_variation: item.before.principalVariation,
        is_mate_score: item.before.isMateScore || item.after.isMateScore ? 1 : 0,
      });
    }

    updateGameAnalysisStatus(db, game.id, {
      status: 'analyzed',
      analysis_engine: 'Stockfish 18 Lite WASM',
      analysis_depth: ANALYSIS_DEPTH,
    });
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }

  return gameMoves.length;
}

async function main() {
  console.log(`=== Stockfish Depth 16 Backfill Analysis ===`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Depth: ${ANALYSIS_DEPTH} (with Depth 8 best move capture)`);
  console.log(`Parallel Workers: ${NUM_WORKERS} | Game Pipeline: ${CONCURRENT_GAMES}`);

  const db = initDb(DB_PATH);

  const unanalyzedGames = db.prepare(`
    SELECT id, player_color, start_fen, result
    FROM games
    WHERE status != 'analyzed'
    ORDER BY date ASC
  `).all();

  console.log(`Found ${unanalyzedGames.length} unanalyzed games remaining in database.`);

  if (unanalyzedGames.length === 0) {
    console.log('All games are already analyzed!');
    db.close();
    return;
  }

  const pool = new ForkedStockfishPool(NUM_WORKERS);
  await pool.init();
  console.log(`Stockfish pool initialized with ${NUM_WORKERS} workers.`);

  const fenCache = new Map();
  const getEval = (fen) => {
    if (!fenCache.has(fen)) {
      fenCache.set(fen, pool.analyze(fen, ANALYSIS_DEPTH));
    }
    return fenCache.get(fen);
  };

  const startTime = Date.now();
  let totalMovesAnalyzed = 0;
  let gamesCompleted = 0;

  // Process games in sliding pipeline window
  let activeIndex = 0;
  const inFlight = new Set();

  while (activeIndex < unanalyzedGames.length || inFlight.size > 0) {
    while (inFlight.size < CONCURRENT_GAMES && activeIndex < unanalyzedGames.length) {
      const game = unanalyzedGames[activeIndex++];
      const task = analyzeSingleGame(db, game, getEval)
        .then((movesCount) => {
          totalMovesAnalyzed += movesCount;
          gamesCompleted += 1;
          inFlight.delete(task);

          if (gamesCompleted % 20 === 0 || gamesCompleted === unanalyzedGames.length) {
            const elapsedSec = (Date.now() - startTime) / 1000;
            const speed = (totalMovesAnalyzed / Math.max(0.1, elapsedSec)).toFixed(1);
            const percent = ((gamesCompleted / unanalyzedGames.length) * 100).toFixed(1);
            console.log(
              `[${gamesCompleted}/${unanalyzedGames.length} (${percent}%)] ` +
              `Moves: ${totalMovesAnalyzed} (${speed} moves/s) | Unique FENs: ${fenCache.size} | Elapsed: ${elapsedSec.toFixed(1)}s`
            );
          }
        })
        .catch((err) => {
          console.error(`Error analyzing game ${game.id}:`, err);
          inFlight.delete(task);
        });

      inFlight.add(task);
    }

    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Analysis Complete ===`);
  console.log(`Games Analyzed: ${gamesCompleted}`);
  console.log(`Total Moves Analyzed: ${totalMovesAnalyzed}`);
  console.log(`Unique FEN Positions: ${fenCache.size}`);
  console.log(`Total Wall-Clock Time: ${totalTimeSec} seconds (${(totalTimeSec / 60).toFixed(2)} minutes)`);
  console.log(`Average Speed: ${(totalMovesAnalyzed / totalTimeSec).toFixed(1)} moves/second`);

  pool.close();
  db.close();
}

main().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});




