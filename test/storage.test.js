import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PracticeSession } from '../engine/practiceSession.js';
import {
  getGameHistory,
  getWeaknessTally,
  initDb,
  saveGameSession,
  saveWeaknessTags,
} from '../storage/db.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
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
  const analyses = [
    { bestMove: 'e7e5', evalCp: 24, isMateScore: false, principalVariation: ['e7e5', 'g1f3'] },
    { bestMove: 'g1f3', evalCp: -18, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
    { bestMove: 'g1f3', evalCp: 12, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
  ];
  const engine = {
    async analyzePosition() {
      return analyses.shift();
    },
    async playMove() {
      return 'g1f3';
    },
  };

  const session = new PracticeSession({
    puzzle: {
      PuzzleId: 'seed-storage-1',
      FEN: RAW_FEN,
      Moves: 'e2e4 e7e5 g1f3',
      weaknessCategory: 'tactical',
    },
    engine,
    gameId,
    now: () => NOW,
  });

  await session.playTurn('c7c5');
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
      assert.equal(move.eval_cp_before, original.eval_cp_before);
      assert.equal(move.eval_cp_after, original.eval_cp_after);
      assert.equal(move.best_move, original.best_move);
      assert.equal(move.principal_variation, original.principal_variation);
      assert.equal(move.is_mate_score, original.is_mate_score);
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

test('initDb migrates legacy eval_cp into eval_cp_before without fabricating eval_cp_after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-storage-migration-'));
  const path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE games (id TEXT PRIMARY KEY, date TEXT, mode TEXT, result TEXT, seeded_weakness TEXT, seed_puzzle_id TEXT, start_fen TEXT, current_fen TEXT);
    CREATE TABLE moves (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT, ply_number INTEGER, fen_before TEXT, move_played TEXT, eval_cp INTEGER, stockfish_response TEXT, timestamp TEXT);
    CREATE TABLE weakness_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, move_id INTEGER, category TEXT, severity TEXT, source TEXT);
    INSERT INTO games VALUES ('legacy-game', '${NOW}', 'practice', NULL, NULL, NULL, '${START_FEN}', '${START_FEN}');
    INSERT INTO moves (game_id, ply_number, fen_before, move_played, eval_cp, stockfish_response, timestamp)
    VALUES ('legacy-game', 1, '${START_FEN}', 'e2e4', 35, NULL, '${NOW}');
  `);
  legacy.close();

  const db = initDb(path);
  try {
    const row = db.prepare('SELECT eval_cp_before, eval_cp_after, is_mate_score FROM moves WHERE id = 1').get();
    assert.deepEqual({ ...row }, { eval_cp_before: 35, eval_cp_after: null, is_mate_score: 0 });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
