import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PracticeSession } from '../engine/practiceSession.js';
import {
  getGameHistory,
  getWeaknessTally,
  initDb,
  saveGameSession,
  saveWeaknessTags,
} from '../storage/db.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NOW = '2026-08-15T09:00:00.000Z';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'chess-storage-'));
  const db = initDb(join(dir, 'test.sqlite'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function buildPracticeSummary(gameId = 'game-storage-1') {
  const engine = {
    async analyzePosition() {
      return { bestMove: 'e2e4', evalCp: 24, principalVariation: ['e2e4'] };
    },
    async playMove() {
      return 'e7e5';
    },
  };

  const session = new PracticeSession({
    puzzle: {
      PuzzleId: 'seed-storage-1',
      FEN: START_FEN,
      weaknessCategory: 'tactical',
    },
    engine,
    gameId,
    now: () => NOW,
  });

  await session.playTurn('e2e4');
  return session.end('1-0');
}

test('initDb creates games, moves, and weakness_tags tables', () => withTempDb((db) => {
  const tableNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('games', 'moves', 'weakness_tags')
    ORDER BY name
  `).all().map((row) => row.name);

  assert.deepEqual(tableNames, ['games', 'moves', 'weakness_tags']);
}));

test('saveGameSession round-trips a real PracticeSession.summary()', async () => {
  const summary = await buildPracticeSummary();

  return withTempDb((db) => {
    saveGameSession(db, summary);
    const [stored] = getGameHistory(db);

    assert.equal(stored.id, summary.id);
    assert.equal(stored.date, NOW);
    assert.equal(stored.mode, summary.mode);
    assert.equal(stored.result, summary.result);
    assert.equal(stored.seeded_weakness, summary.seeded_weakness);
    assert.equal(stored.seed_puzzle_id, summary.seed_puzzle_id);
    assert.equal(stored.start_fen, summary.start_fen);
    assert.equal(stored.current_fen, summary.current_fen);
    assert.equal(stored.moves.length, summary.moves.length);

    stored.moves.forEach((move, index) => {
      const original = summary.moves[index];
      assert.equal(typeof move.id, 'number');
      assert.equal(move.game_id, original.game_id);
      assert.equal(move.ply_number, original.ply_number);
      assert.equal(move.fen_before, original.fen_before);
      assert.equal(move.move_played, original.move_played);
      assert.equal(move.eval_cp, original.eval_cp);
      assert.equal(move.stockfish_response, original.stockfish_response);
      assert.equal(move.timestamp, original.timestamp);
    });
  });
});

test('saveGameSession rolls back the whole game when a move is malformed', async () => {
  const summary = await buildPracticeSummary('game-rollback');
  const malformed = {
    ...summary,
    moves: summary.moves.map((move) => ({ ...move })),
  };
  malformed.moves[1].game_id = 'wrong-game-id';

  return withTempDb((db) => {
    assert.throws(
      () => saveGameSession(db, malformed),
      /does not match session id/,
    );

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM moves').get().count, 0);
  });
});

test('getWeaknessTally returns category counts from stored move tags', async () => {
  const summary = await buildPracticeSummary('game-tally');

  return withTempDb((db) => {
    saveGameSession(db, summary);
    const [stored] = getGameHistory(db);
    const [firstMove, secondMove] = stored.moves;

    saveWeaknessTags(db, firstMove.id, [
      { category: 'tactical', severity: 'high' },
      { category: 'king_safety', severity: 'medium' },
    ]);
    saveWeaknessTags(db, secondMove.id, [
      { category: 'tactical', severity: 'low' },
      { category: 'pawn_structure', severity: 'low' },
    ]);

    assert.deepEqual(getWeaknessTally(db), [
      { category: 'tactical', count: 2 },
      { category: 'king_safety', count: 1 },
      { category: 'pawn_structure', count: 1 },
    ]);

    const sources = db.prepare('SELECT DISTINCT source FROM weakness_tags').all().map((row) => row.source);
    assert.deepEqual(sources, ['ai_classification']);
  });
});
