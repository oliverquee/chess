import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { computeEvalDelta } from '../engine/eval.js';
import { applyUciMoveToFen } from '../engine/fen.js';
import { createNodeWorker } from '../engine/nodeWorkerAdapter.js';
import { StockfishWorkerClient } from '../engine/stockfishWorker.js';
import { importCompletedPgn } from '../import/pgnImport.js';
import { getGameById, initDb } from '../storage/db.js';

const WORKER_URL = new URL('../engine/vendor/stockfish/stockfish.js', import.meta.url);
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.14"]
[White "Opponent"]
[Black "Oliver"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 1/2-1/2`;

test('M4 real Stockfish evaluates a completed PGN and survives SQLite reopen', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-m4-import-'));
  const path = join(dir, 'history.sqlite');
  const engine = new StockfishWorkerClient({
    workerUrl: WORKER_URL,
    workerFactory: createNodeWorker,
    analysisDepth: 4,
    commandTimeoutMs: 15000,
    searchTimeoutMs: 30000,
  });
  try {
    let db = initDb(path);
    const summary = await importCompletedPgn({
      db,
      pgn: PGN,
      username: 'Oliver',
      engine,
      now: () => '2026-08-15T16:00:00.000Z',
      gameId: 'm4-real-import',
    });
    db.close();
    assert.match(summary.analysis_engine, /Stockfish 18/i);
    assert.equal(summary.player_color, 'black');
    assert.equal(summary.moves.length, 4);

    db = initDb(path);
    const stored = getGameById(db, summary.id);
    db.close();
    assert.equal(stored.mode, 'imported');
    assert.equal(stored.status, 'completed');
    assert.equal(stored.player_color, 'black');
    assert.equal(stored.moves.length, 4);
    stored.moves.forEach((move, index) => {
      assert.equal(move.ply_number, index + 1);
      assert.equal(move.timestamp_source, 'posthoc_analysis');
      assert.doesNotThrow(() => new Chess(move.fen_before));
      const applied = applyUciMoveToFen(move.fen_before, move.move_played);
      assert.equal(applied, stored.moves[index + 1]?.fen_before ?? stored.current_fen);
      if (move.best_move) assert.doesNotThrow(() => applyUciMoveToFen(move.fen_before, move.best_move));
      if (move.principal_variation) {
        let pvFen = move.fen_before;
        for (const pvMove of move.principal_variation.split(/\s+/)) pvFen = applyUciMoveToFen(pvFen, pvMove);
      }
      assert.equal(typeof move.eval_cp_before, 'number');
      assert.equal(typeof move.eval_cp_after, 'number');
      assert.ok(computeEvalDelta(move) === null || Number.isInteger(computeEvalDelta(move)));
    });
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
