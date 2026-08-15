import test from 'node:test';
import assert from 'node:assert/strict';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import {
  getGameHistory,
  getGameStatus,
  initDb,
  saveWeaknessTags,
  transitionGameStatus,
} from '../storage/db.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function seedPuzzleDb() {
  const db = initPuzzleDb(':memory:');
  const insertPuzzle = db.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
  const insertTheme = db.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');
  insertPuzzle.run('short', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6', 1200, 4);
  insertPuzzle.run('long', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6', 1400, 8);
  insertTheme.run('fork', 'short');
  insertTheme.run('fork', 'long');
  return db;
}

function deterministicEngine() {
  const analyses = [
    { bestMove: 'e7e5', evalCp: 30, isMateScore: false, principalVariation: ['e7e5', 'g1f3'] },
    { bestMove: 'g1f3', evalCp: -10, isMateScore: false, principalVariation: ['g1f3'] },
    { bestMove: 'g1f3', evalCp: 5, isMateScore: false, principalVariation: ['g1f3'] },
  ];
  return {
    async analyzePosition() { return analyses.shift(); },
    async playMove() { return 'g1f3'; },
  };
}

test('M2 runs weakness → queue → practice → persist → analyzed → next-focus without UI', async () => {
  const db = initDb(':memory:');
  const puzzleDb = seedPuzzleDb();
  let id = 0;
  const orchestrator = new TrainingOrchestrator({
    db,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: deterministicEngine,
    idFactory: () => `session-${++id}`,
    now: () => '2026-08-15T13:00:00.000Z',
  });

  try {
    const started = orchestrator.startTargetedSession(['practical_time', 'tactical']);
    assert.equal(started.weaknessCategory, 'tactical');
    assert.equal(started.skipped[0].category, 'practical_time');
    assert.deepEqual(started.queued.map((item) => item.id), ['session-1', 'session-2']);
    assert.equal(getGameStatus(db, 'session-1'), 'in_progress');
    assert.equal(getGameStatus(db, 'session-2'), 'queued');

    await started.activeSession.playTurn('c7c5');
    const summary = started.activeSession.end('*');
    orchestrator.completeSession(summary);
    assert.equal(getGameStatus(db, 'session-1'), 'completed');

    const stored = getGameHistory(db, { weaknessCategory: 'tactical' })
      .find((game) => game.id === 'session-1');
    assert.ok(stored);
    assert.equal(stored.status, 'completed');
    assert.equal(stored.moves.length, 2);
    saveWeaknessTags(db, stored.moves[0].id, { category: 'tactical', severity: 'high' });

    orchestrator.markAnalyzed('session-1');
    assert.equal(getGameStatus(db, 'session-1'), 'analyzed');
    assert.throws(
      () => transitionGameStatus(db, 'session-2', 'analyzed'),
      /Invalid game status transition: queued → analyzed/,
    );
    assert.equal(getGameStatus(db, 'session-2'), 'queued');

    const nextFocus = orchestrator.getNextFocus();
    assert.equal(nextFocus.weaknessCategory, 'tactical');
    assert.equal(nextFocus.puzzles.length, 2);

    const second = orchestrator.startNextQueuedSession();
    assert.equal(second.gameId, 'session-2');
    assert.equal(getGameStatus(db, 'session-2'), 'in_progress');
  } finally {
    puzzleDb.close();
    db.close();
  }
});

test('target queue creation is atomic when session IDs collide', () => {
  const db = initDb(':memory:');
  const puzzleDb = seedPuzzleDb();
  const orchestrator = new TrainingOrchestrator({
    db,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: deterministicEngine,
    idFactory: () => 'duplicate-session',
  });

  try {
    assert.throws(
      () => orchestrator.startTargetedSession(['tactical']),
      /UNIQUE constraint failed/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games').get().count, 0);
    assert.equal(orchestrator.queue.length, 0);
  } finally {
    puzzleDb.close();
    db.close();
  }
});

test('engine construction failure does not falsely mark a queued game in progress', () => {
  const db = initDb(':memory:');
  const puzzleDb = seedPuzzleDb();
  let id = 0;
  const orchestrator = new TrainingOrchestrator({
    db,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: () => { throw new Error('engine unavailable'); },
    idFactory: () => `engine-failure-${++id}`,
  });

  try {
    assert.throws(
      () => orchestrator.startTargetedSession(['tactical']),
      /engine unavailable/,
    );
    assert.equal(getGameStatus(db, 'engine-failure-1'), 'queued');
    assert.equal(getGameStatus(db, 'engine-failure-2'), 'queued');
  } finally {
    puzzleDb.close();
    db.close();
  }
});
