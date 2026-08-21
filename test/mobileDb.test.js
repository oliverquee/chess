import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PracticeSession } from '../engine/practiceSession.js';
import {
  completeGameSession,
  createQueuedGame,
  createQueuedGames,
  exportDatabaseJson,
  getCategoryMastery,
  getDailyStats,
  getGameHistory,
  getGameStatus,
  getHintLogs,
  getRecentDailyStats,
  getSeedScore,
  getSettings,
  getStreakState,
  getWeaknessTally,
  importDatabaseJson,
  recordDailySession,
  resetUserData,
  saveGameSession,
  saveHintLog,
  saveSeedScore,
  saveWeaknessTags,
  setSetting,
  transitionGameStatus,
  updateCategoryMastery,
  updateStreakState,
} from '../storage/mobileDb.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const NOW = '2026-08-15T09:00:00.000Z';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported','freeplay')),
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
  analysis_depth INTEGER NULL,
  assistance_level TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full')),
  hint_count INTEGER NOT NULL DEFAULT 0,
  takeback_count INTEGER NOT NULL DEFAULT 0,
  time_control TEXT NULL,
  persona TEXT NULL
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  accuracy_component REAL NOT NULL,
  motif_component REAL NOT NULL,
  hint_penalty REAL NOT NULL,
  total_score REAL NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  goal_target INTEGER NOT NULL DEFAULT 3,
  goal_met INTEGER NOT NULL DEFAULT 0 CHECK(goal_met IN (0,1)),
  total_score REAL NOT NULL DEFAULT 0,
  streak_day_counted INTEGER NOT NULL DEFAULT 0 CHECK(streak_day_counted IN (0,1))
);

CREATE TABLE IF NOT EXISTS streak_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  freezes_remaining INTEGER NOT NULL DEFAULT 2,
  freezes_month TEXT NULL,
  last_counted_date TEXT NULL
);

CREATE TABLE IF NOT EXISTS category_mastery (
  category TEXT PRIMARY KEY CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  mastery_level INTEGER NOT NULL DEFAULT 0 CHECK(mastery_level BETWEEN 0 AND 5),
  last_practiced_at TEXT NULL,
  decay_checked_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS hint_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  fen TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('warm','warmer','hot')),
  detector TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  detector TEXT NOT NULL,
  result_json TEXT NOT NULL,
  games_analyzed INTEGER NOT NULL,
  moves_analyzed INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_detector ON analysis_results(detector);
`;

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

test('mobileDb: getWeaknessTally returns category counts from unassisted games only', async () => {
  const db = createMockCapacitorDb();
  try {
    const unassistedSummary = await buildPracticeSummary('game-mobile-unassisted');
    const assistedSummary = await buildPracticeSummary('game-mobile-assisted');
    assistedSummary.assistance_level = 'hints';

    await saveGameSession(db, unassistedSummary);
    await saveGameSession(db, assistedSummary);

    const history = await getGameHistory(db);
    const unassistedStored = history.find((g) => g.id === 'game-mobile-unassisted');
    const assistedStored = history.find((g) => g.id === 'game-mobile-assisted');

    await saveWeaknessTags(db, unassistedStored.moves[0].id, [
      { category: 'tactical', severity: 'high' },
      { category: 'king_safety', severity: 'medium' },
    ]);
    await saveWeaknessTags(db, assistedStored.moves[0].id, [
      { category: 'tactical', severity: 'high' },
      { category: 'endgame_technique', severity: 'high' },
    ]);

    const tally = await getWeaknessTally(db);
    assert.deepEqual(tally, [
      { category: 'king_safety', count: 1 },
      { category: 'tactical', count: 1 },
    ]);
    assert.ok(!tally.some((t) => t.category === 'endgame_technique'));
  } finally {
    db.close();
  }
});

test('mobileDb: seed scores, hint logs, daily stats, streaks, mastery, export/import round-trip', async () => {
  const db = createMockCapacitorDb();
  try {
    // 1. Settings
    await setSetting(db, 'daily_goal', '4');
    await setSetting(db, 'freeplay_persona', 'hunter');
    const settings = await getSettings(db);
    assert.equal(settings.daily_goal, '4');
    assert.equal(settings.freeplay_persona, 'hunter');

    // 2. Games + Seed Score + Hint Log
    await saveGameSession(db, {
      id: 'm-seed-game-1',
      date: '2026-08-21T10:00:00.000Z',
      mode: 'practice',
      moves: [{
        game_id: 'm-seed-game-1',
        ply_number: 1,
        fen_before: START_FEN,
        move_played: 'e2e4',
        timestamp: '2026-08-21T10:00:01.000Z',
      }],
    });
    await saveSeedScore(db, {
      gameId: 'm-seed-game-1',
      accuracyComponent: 60.0,
      motifComponent: 30.0,
      hintPenalty: 0.0,
      totalScore: 90.0,
    });
    const seedScore = await getSeedScore(db, 'm-seed-game-1');
    assert.equal(seedScore.total_score, 90.0);

    await saveHintLog(db, {
      gameId: 'm-seed-game-1',
      fen: START_FEN,
      tier: 'warmer',
      detector: 'null_move_threat',
    });
    const hints = await getHintLogs(db, 'm-seed-game-1');
    assert.equal(hints.length, 1);
    assert.equal(hints[0].tier, 'warmer');

    // 3. Daily Stats
    await recordDailySession(db, { date: '2026-08-21', targetGoal: 3, sessionScore: 85, isCountedStreakDay: 1 });
    const daily = await getDailyStats(db, '2026-08-21');
    assert.equal(daily.sessionsCompleted, 1);
    assert.equal(daily.totalScore, 85);

    // 4. Streak State
    await updateStreakState(db, {
      currentStreak: 3,
      longestStreak: 7,
      freezesRemaining: 2,
      freezesMonth: '2026-08',
      lastCountedDate: '2026-08-21',
    });
    const streak = await getStreakState(db);
    assert.equal(streak.currentStreak, 3);

    // 5. Category Mastery
    await updateCategoryMastery(db, {
      category: 'king_safety',
      masteryLevel: 4,
      lastPracticedAt: '2026-08-21T10:00:00.000Z',
    });
    const mastery = await getCategoryMastery(db);
    assert.equal(mastery.king_safety.masteryLevel, 4);

    // 6. Export and Import
    const exported = await exportDatabaseJson(db);
    assert.ok(exported.tables.games.length >= 1);
    assert.ok(exported.tables.seed_scores.length >= 1);

    await resetUserData(db);
    assert.equal((await getGameHistory(db)).length, 0);

    await importDatabaseJson(db, exported);
    assert.equal((await getGameHistory(db)).length, 1);
    assert.equal((await getSeedScore(db, 'm-seed-game-1')).total_score, 90.0);
  } finally {
    db.close();
  }
});
