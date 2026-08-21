import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PracticeSession } from '../engine/practiceSession.js';
import {
  completeGameSession,
  createQueuedGame,
  createQueuedGames,
  getGameHistory,
  getGameStatus,
  getWeaknessTally,
  saveGameSession,
  saveWeaknessTags,
  transitionGameStatus,
} from '../storage/mobileDb.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const NOW = '2026-08-15T09:00:00.000Z';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','in_progress','completed','analyzed')),
  result TEXT,
  seeded_weakness TEXT NULL,
  seed_puzzle_id TEXT NULL,
  start_fen TEXT,
  current_fen TEXT,
  import_source TEXT NULL,
  external_game_id TEXT NULL,
  player_color TEXT NULL CHECK(player_color IN ('white','black')),
  white_player TEXT NULL,
  black_player TEXT NULL,
  analysis_engine TEXT NULL,
  analysis_depth INTEGER NULL
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT REFERENCES games(id),
  ply_number INTEGER,
  fen_before TEXT,
  move_played TEXT,
  eval_cp_before INTEGER NULL,
  eval_cp_after INTEGER NULL,
  best_move TEXT NULL,
  principal_variation TEXT NULL,
  is_mate_score INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1)),
  stockfish_response TEXT NULL,
  timestamp TEXT,
  timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
    CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))
);

CREATE TABLE IF NOT EXISTS move_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER NOT NULL REFERENCES moves(id),
  status TEXT NOT NULL CHECK(status IN ('classified','unclassified')),
  category TEXT NULL CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT NULL CHECK(severity IN ('low','medium','high')),
  rationale TEXT NULL,
  error TEXT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 2),
  model_used TEXT NOT NULL,
  backend TEXT NOT NULL CHECK(backend IN ('claude','ollama')),
  prompt_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  analysis_timestamp TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  CHECK(
    (status = 'classified' AND category IS NOT NULL AND severity IS NOT NULL AND rationale IS NOT NULL)
    OR
    (status = 'unclassified' AND category IS NULL AND severity IS NULL AND error IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS weakness_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER REFERENCES moves(id),
  category TEXT CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT CHECK(severity IN ('low','medium','high')),
  source TEXT DEFAULT 'ai_classification',
  classification_id INTEGER NULL REFERENCES move_classifications(id)
);
`;

/**
 * Creates a mock Capacitor SQLite connection backed by node:sqlite DatabaseSync
 * so we can exercise mobileDb.js with real SQL semantics and async Promise contracts.
 */
function createMockCapacitorDb() {
  const syncDb = new DatabaseSync(':memory:');
  syncDb.exec('PRAGMA foreign_keys = ON;');
  const statements = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    syncDb.exec(statement + ';');
  }

  return {
    async execute(sql) {
      syncDb.exec(sql);
      return { changes: { changes: 0 } };
    },
    async run(sql, values = []) {
      const stmt = syncDb.prepare(sql);
      const result = stmt.run(...values);
      return {
        changes: {
          changes: Number(result.changes),
          lastId: Number(result.lastInsertRowid),
        },
      };
    },
    async query(sql, values = []) {
      const stmt = syncDb.prepare(sql);
      const rows = stmt.all(...values);
      return { values: rows };
    },
    close() {
      syncDb.close();
    },
  };
}

async function buildPracticeSummary(gameId = 'game-mobile-1') {
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
      PuzzleId: 'seed-mobile-1',
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

test('mobileDb: saveGameSession round-trips an async PracticeSession.summary()', async () => {
  const db = createMockCapacitorDb();
  try {
    const summary = await buildPracticeSummary();
    const savedId = await saveGameSession(db, summary);
    assert.equal(savedId, summary.id);

    const history = await getGameHistory(db);
    assert.equal(history.length, 1);
    const stored = history[0];

    assert.equal(stored.id, summary.id);
    assert.equal(stored.date, NOW);
    assert.equal(stored.mode, summary.mode);
    assert.equal(stored.status, 'completed');
    assert.equal(stored.result, summary.result);
    assert.equal(stored.seeded_weakness, 'tactical');
    assert.equal(stored.moves.length, 2);

    assert.equal(stored.moves[0].move_played, 'c7c5');
    assert.equal(stored.moves[0].eval_cp_before, 24);
    assert.equal(stored.moves[0].eval_cp_after, -18);
  } finally {
    db.close();
  }
});

test('mobileDb: native transaction API disables nested per-statement transactions', async () => {
  const backingDb = createMockCapacitorDb();
  const transactionFlags = [];
  const db = {
    execute: (sql, transaction) => {
      transactionFlags.push(transaction);
      return backingDb.execute(sql);
    },
    run: (sql, values, transaction) => {
      transactionFlags.push(transaction);
      return backingDb.run(sql, values);
    },
    query: backingDb.query,
    beginTransaction: () => backingDb.execute('BEGIN IMMEDIATE'),
    commitTransaction: () => backingDb.execute('COMMIT'),
    rollbackTransaction: () => backingDb.execute('ROLLBACK'),
  };

  try {
    await createQueuedGames(db, [{
      id: 'native-transaction-seed',
      date: NOW,
      seeded_weakness: 'tactical',
      seed_puzzle_id: 'seed-native-1',
      start_fen: START_FEN,
      current_fen: START_FEN,
    }]);
    assert.deepEqual(transactionFlags, [false]);
    assert.equal(await getGameStatus(db, 'native-transaction-seed'), 'queued');
  } finally {
    backingDb.close();
  }
});

test('mobileDb: completeGameSession rolls status and move inserts back atomically on error', async () => {
  const db = createMockCapacitorDb();
  try {
    const summary = await buildPracticeSummary('game-mobile-rollback');
    await createQueuedGame(db, {
      id: summary.id,
      date: NOW,
      seeded_weakness: summary.seeded_weakness,
      seed_puzzle_id: summary.seed_puzzle_id,
      start_fen: summary.start_fen,
    });
    await transitionGameStatus(db, summary.id, 'in_progress');

    const malformed = {
      ...summary,
      moves: summary.moves.map((move) => ({ ...move })),
    };
    malformed.moves[1].ply_number = 99; // corrupt ply number

    await assert.rejects(
      () => completeGameSession(db, malformed),
      /Expected ply_number 2, received 99/,
    );

    assert.equal(await getGameStatus(db, summary.id), 'in_progress');
    const moveCount = (await db.query('SELECT COUNT(*) as count FROM moves')).values[0].count;
    assert.equal(moveCount, 0);
  } finally {
    db.close();
  }
});

test('mobileDb: getWeaknessTally returns category counts from stored tags', async () => {
  const db = createMockCapacitorDb();
  try {
    const summary = await buildPracticeSummary('game-mobile-tally');
    await saveGameSession(db, summary);
    const [stored] = await getGameHistory(db);

    await saveWeaknessTags(db, stored.moves[0].id, [
      { category: 'tactical', severity: 'high' },
      { category: 'king_safety', severity: 'medium' },
    ]);
    await saveWeaknessTags(db, stored.moves[1].id, [
      { category: 'tactical', severity: 'low' },
    ]);

    const tally = await getWeaknessTally(db);
    assert.deepEqual(tally, [
      { category: 'tactical', count: 2 },
      { category: 'king_safety', count: 1 },
    ]);
  } finally {
    db.close();
  }
});
