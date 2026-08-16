import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { applyUciMoveToFen } from '../engine/fen.js';
import { computeEvalDelta } from '../engine/eval.js';
import { createNodeWorker } from '../engine/nodeWorkerAdapter.js';
import { PracticeSession } from '../engine/practiceSession.js';
import { StockfishWorkerClient } from '../engine/stockfishWorker.js';
import { getGameHistory, initDb, saveGameSession } from '../storage/db.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WORKER_URL = new URL('../engine/vendor/stockfish/stockfish.js', import.meta.url);

function firstLegalUci(fen) {
  const [move] = new Chess(fen).moves({ verbose: true });
  if (!move) return null;
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function assertLegalPv(fen, principalVariation) {
  let current = fen;
  for (const move of principalVariation.split(/\s+/).filter(Boolean)) {
    current = applyUciMoveToFen(current, move);
  }
}

test('M1 real Stockfish game survives a SQLite close/reopen round-trip', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-m1-roundtrip-'));
  const dbPath = join(dir, 'history.sqlite');
  const engine = new StockfishWorkerClient({
    workerUrl: WORKER_URL,
    workerFactory: createNodeWorker,
    analysisDepth: 5,
    playDepth: 5,
    commandTimeoutMs: 15000,
    searchTimeoutMs: 30000,
  });

  try {
    const session = new PracticeSession({
      puzzle: {
        PuzzleId: 'm1-real-seed',
        FEN: RAW_FEN,
        Moves: 'e2e4 e7e5 g1f3',
        weaknessCategory: 'tactical',
      },
      engine,
      skillLevel: 5,
      analysisDepth: 5,
      gameId: 'm1-real-game',
      now: () => '2026-08-15T12:00:00.000Z',
    });

    await session.run(({ fen }) => firstLegalUci(fen), { maxTurns: 3 });
    const summary = session.end('*');

    assert.match(engine.engineName, /Stockfish 18/i);
    assert.equal(summary.moves.length, 6);
    assert.equal(summary.start_fen, applyUciMoveToFen(RAW_FEN, 'e2e4'));

    for (const [index, move] of summary.moves.entries()) {
      assert.equal(move.ply_number, index + 1);
      assert.doesNotThrow(() => new Chess(move.fen_before));
      assert.doesNotThrow(() => applyUciMoveToFen(move.fen_before, move.move_played));
      assert.equal(typeof move.best_move, 'string');
      assert.doesNotThrow(() => applyUciMoveToFen(move.fen_before, move.best_move));
      if (move.principal_variation) {
        assert.doesNotThrow(() => assertLegalPv(move.fen_before, move.principal_variation));
      }
      assert.equal(typeof move.eval_cp_before, 'number');
      assert.equal(typeof move.eval_cp_after, 'number');
      assert.ok(computeEvalDelta(move) === null || Number.isInteger(computeEvalDelta(move)));

      const applied = applyUciMoveToFen(move.fen_before, move.move_played);
      const expectedNextFen = summary.moves[index + 1]?.fen_before ?? summary.current_fen;
      assert.equal(applied, expectedNextFen);
    }

    let db = initDb(dbPath);
    saveGameSession(db, summary);
    db.close();

    db = initDb(dbPath);
    const [stored] = getGameHistory(db);
    db.close();

    assert.equal(stored.id, summary.id);
    assert.equal(stored.start_fen, summary.start_fen);
    assert.equal(stored.current_fen, summary.current_fen);
    assert.equal(stored.result, summary.result);
    assert.equal(stored.moves.length, summary.moves.length);
    stored.moves.forEach((move, index) => {
      const original = summary.moves[index];
      for (const field of [
        'game_id',
        'ply_number',
        'fen_before',
        'move_played',
        'eval_cp_before',
        'eval_cp_after',
        'best_move',
        'principal_variation',
        'is_mate_score',
        'stockfish_response',
        'timestamp',
      ]) {
        assert.equal(move[field], original[field], `${field} changed during persistence`);
      }
    });
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
