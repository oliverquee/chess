import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PracticeSession } from '../engine/practiceSession.js';
import {
  completeGameSession,
  createQueuedGame,
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
  initDb,
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
    assert.equal(stored.status, 'completed');
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
    const row = db.prepare(`
      SELECT m.eval_cp_before, m.eval_cp_after, m.is_mate_score, m.timestamp_source, g.status
      FROM moves m JOIN games g ON g.id = m.game_id
      WHERE m.id = 1
    `).get();
    assert.deepEqual(
      { ...row },
      { eval_cp_before: 35, eval_cp_after: null, is_mate_score: 0, timestamp_source: 'live_recorded', status: 'completed' },
    );
    const classificationTable = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'move_classifications'
    `).get();
    assert.equal(classificationTable.name, 'move_classifications');
    const weaknessColumns = db.prepare('PRAGMA table_info(weakness_tags)').all().map((column) => column.name);
    assert.ok(weaknessColumns.includes('classification_id'));
    const gameColumns = db.prepare('PRAGMA table_info(games)').all().map((column) => column.name);
    for (const column of ['import_source', 'external_game_id', 'player_color', 'analysis_engine', 'assistance_level']) {
      assert.ok(gameColumns.includes(column));
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completeGameSession rolls status and move inserts back together', async () => {
  const summary = await buildPracticeSummary('game-complete-rollback');
  const malformed = {
    ...summary,
    moves: summary.moves.map((move) => ({ ...move })),
  };
  malformed.moves[1].ply_number = 9;

  return withTempDb((db) => {
    createQueuedGame(db, {
      id: summary.id,
      date: NOW,
      seeded_weakness: summary.seeded_weakness,
      seed_puzzle_id: summary.seed_puzzle_id,
      start_fen: summary.start_fen,
    });
    transitionGameStatus(db, summary.id, 'in_progress');

    assert.throws(
      () => completeGameSession(db, malformed),
      /Expected ply_number 2, received 9/,
    );
    assert.equal(getGameStatus(db, summary.id), 'in_progress');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM moves').get().count, 0);
  });
});

test('queued and in-progress lifecycle state survives a SQLite close/reopen boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-lifecycle-'));
  const path = join(dir, 'lifecycle.sqlite');
  let db = initDb(path);
  try {
    createQueuedGame(db, {
      id: 'durable-session',
      date: NOW,
      seeded_weakness: 'tactical',
      seed_puzzle_id: 'seed-durable',
      start_fen: START_FEN,
    });
    assert.equal(getGameStatus(db, 'durable-session'), 'queued');
    db.close();

    db = initDb(path);
    assert.equal(getGameStatus(db, 'durable-session'), 'queued');
    transitionGameStatus(db, 'durable-session', 'in_progress');
    db.close();

    db = initDb(path);
    assert.equal(getGameStatus(db, 'durable-session'), 'in_progress');
  } finally {
    try { db.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getWeaknessTally returns category counts from unassisted games only', async () => {
  const unassistedSummary = await buildPracticeSummary('game-unassisted');
  const assistedSummary = await buildPracticeSummary('game-assisted');
  assistedSummary.assistance_level = 'hints';

  return withTempDb((db) => {
    saveGameSession(db, unassistedSummary);
    saveGameSession(db, assistedSummary);

    const [unassistedStored] = getGameHistory(db).filter((g) => g.id === 'game-unassisted');
    const [assistedStored] = getGameHistory(db).filter((g) => g.id === 'game-assisted');

    saveWeaknessTags(db, unassistedStored.moves[0].id, [
      { category: 'tactical', severity: 'high' },
      { category: 'king_safety', severity: 'medium' },
    ]);
    saveWeaknessTags(db, assistedStored.moves[0].id, [
      { category: 'tactical', severity: 'high' },
      { category: 'endgame_technique', severity: 'high' },
    ]);

    const tally = getWeaknessTally(db);
    assert.deepEqual(tally, [
      { category: 'king_safety', count: 1 },
      { category: 'tactical', count: 1 },
    ]);
    // 'endgame_technique' from assisted game MUST be excluded
    assert.ok(!tally.some((t) => t.category === 'endgame_technique'));
  });
});

test('seed scores, hint logs, daily stats, streaks, and mastery persist and round-trip', () => withTempDb((db) => {
  // 1. Settings
  setSetting(db, 'daily_goal', '5');
  setSetting(db, 'freeplay_persona', 'panther');
  const settings = getSettings(db);
  assert.equal(settings.daily_goal, '5');
  assert.equal(settings.freeplay_persona, 'panther');

  // 2. Games + Seed Score + Hint Log
  saveGameSession(db, {
    id: 'seed-game-1',
    date: '2026-08-21T10:00:00.000Z',
    mode: 'practice',
    moves: [{
      game_id: 'seed-game-1',
      ply_number: 1,
      fen_before: START_FEN,
      move_played: 'e2e4',
      timestamp: '2026-08-21T10:00:01.000Z',
    }],
  });
  saveSeedScore(db, {
    gameId: 'seed-game-1',
    accuracyComponent: 55.5,
    motifComponent: 28.0,
    hintPenalty: 5.0,
    totalScore: 78.5,
  });
  const seedScore = getSeedScore(db, 'seed-game-1');
  assert.equal(seedScore.total_score, 78.5);
  assert.equal(seedScore.accuracy_component, 55.5);

  saveHintLog(db, {
    gameId: 'seed-game-1',
    fen: START_FEN,
    tier: 'warm',
    detector: 'hanging_piece',
  });
  const hints = getHintLogs(db, 'seed-game-1');
  assert.equal(hints.length, 1);
  assert.equal(hints[0].tier, 'warm');
  assert.equal(hints[0].detector, 'hanging_piece');

  // 3. Daily Stats
  recordDailySession(db, { date: '2026-08-21', targetGoal: 3, sessionScore: 80, isCountedStreakDay: 1 });
  recordDailySession(db, { date: '2026-08-21', targetGoal: 3, sessionScore: 70, isCountedStreakDay: 1 });
  const daily = getDailyStats(db, '2026-08-21');
  assert.equal(daily.sessionsCompleted, 2);
  assert.equal(daily.totalScore, 150);
  assert.equal(daily.goalMet, false);

  recordDailySession(db, { date: '2026-08-21', targetGoal: 3, sessionScore: 90, isCountedStreakDay: 1 });
  const dailyUpdated = getDailyStats(db, '2026-08-21');
  assert.equal(dailyUpdated.sessionsCompleted, 3);
  assert.equal(dailyUpdated.goalMet, true);

  // 4. Streak State
  updateStreakState(db, {
    currentStreak: 5,
    longestStreak: 10,
    freezesRemaining: 1,
    freezesMonth: '2026-08',
    lastCountedDate: '2026-08-21',
  });
  const streak = getStreakState(db);
  assert.equal(streak.currentStreak, 5);
  assert.equal(streak.longestStreak, 10);
  assert.equal(streak.freezesRemaining, 1);

  // 5. Category Mastery
  updateCategoryMastery(db, {
    category: 'tactical',
    masteryLevel: 3,
    lastPracticedAt: '2026-08-21T10:00:00.000Z',
  });
  const mastery = getCategoryMastery(db);
  assert.equal(mastery.tactical.masteryLevel, 3);
  assert.equal(mastery.king_safety.masteryLevel, 0);

  // 6. Export and Import
  const exported = exportDatabaseJson(db);
  assert.ok(exported.tables.games.length >= 1);
  assert.ok(exported.tables.seed_scores.length >= 1);
  assert.ok(exported.tables.daily_stats.length >= 1);

  resetUserData(db);
  assert.equal(getGameHistory(db).length, 0);
  assert.equal(getSeedScore(db, 'seed-game-1'), null);

  importDatabaseJson(db, exported);
  assert.equal(getGameHistory(db).length, 1);
  assert.equal(getSeedScore(db, 'seed-game-1').total_score, 78.5);
  assert.equal(getDailyStats(db, '2026-08-21').sessionsCompleted, 3);
}));

