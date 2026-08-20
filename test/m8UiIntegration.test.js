import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chess.js';
import { getMotifReadyFen } from '../engine/practiceSession.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import { initDb, getGameHistory, getGameStatus, saveWeaknessTags } from '../storage/db.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import * as dbStorage from '../storage/db.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function createDeterministicEngine() {
  const responses = ['g1f3', 'd2d4', 'b1c3'];
  const evals = [
    { bestMove: 'g1f3', evalCp: 25, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
    { bestMove: 'd2d4', evalCp: 15, isMateScore: false, principalVariation: ['d2d4', 'd7d5'] },
  ];
  return {
    async analyzePosition() { return evals.shift() || { bestMove: 'g1f3', evalCp: 0, isMateScore: false, principalVariation: [] }; },
    async playMove() { return responses.shift() || 'g1f3'; },
  };
}

function seedTestPuzzleDb() {
  const db = initPuzzleDb(':memory:');
  const insertPuzzle = db.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
  const insertTheme = db.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');
  
  insertPuzzle.run('tactical_short', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6', 1200, 4);
  insertPuzzle.run('tactical_long', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6', 1400, 8);
  insertTheme.run('fork', 'tactical_short');
  insertTheme.run('fork', 'tactical_long');
  return db;
}

test('M8: practice session start-slow workflow runs end-to-end and persists to storage', async () => {
  const db = initDb(':memory:');
  const puzzleDb = seedTestPuzzleDb();
  let sessionIndex = 0;

  const orchestrator = new TrainingOrchestrator({
    db,
    storage: dbStorage,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: () => createDeterministicEngine(),
    idFactory: () => `session-${++sessionIndex}`,
    now: () => '2026-08-16T12:00:00.000Z',
  });

  try {
    // 1. Start targeted weakness session
    const target = await orchestrator.startTargetedSession(['tactical']);
    assert.equal(target.weaknessCategory, 'tactical');
    assert.equal(target.queued.length, 2);
    assert.equal(await getGameStatus(db, 'session-1'), 'in_progress');
    assert.equal(await getGameStatus(db, 'session-2'), 'queued');

    // 2. Verify motif-ready FEN startup (Moves[0] applied)
    const expectedMotifFen = getMotifReadyFen({ FEN: RAW_FEN, Moves: 'e2e4 e7e5' });
    assert.equal(target.activeSession.startFen, expectedMotifFen);

    // 3. Play user turn
    const turnResult = await target.activeSession.playTurn('c7c5');
    assert.ok(turnResult.playerLog);
    assert.equal(turnResult.playerLog.move_played, 'c7c5');
    assert.ok(turnResult.engineLog);
    assert.equal(turnResult.engineLog.move_played, 'g1f3');

    // 4. Complete active session
    const summary = target.activeSession.end('*');
    await orchestrator.completeSession(summary);
    assert.equal(await getGameStatus(db, 'session-1'), 'completed');

    // 5. Verify persisted history in DB
    const history = await getGameHistory(db);
    const completedGame = history.find((g) => g.id === 'session-1');
    assert.ok(completedGame);
    assert.equal(completedGame.status, 'completed');
    assert.equal(completedGame.seeded_weakness, 'tactical');
    assert.equal(completedGame.moves.length, 2);

    // 6. Tag weakness and query next focus
    saveWeaknessTags(db, completedGame.moves[0].id, { category: 'tactical', severity: 'high' });
    const nextFocus = await orchestrator.getNextFocus();
    assert.equal(nextFocus.weaknessCategory, 'tactical');

    // 7. Start second queued seed (2/2)
    const secondSession = await orchestrator.startNextQueuedSession();
    assert.ok(secondSession);
    assert.equal(secondSession.gameId, 'session-2');
    assert.equal(await getGameStatus(db, 'session-2'), 'in_progress');
  } finally {
    puzzleDb.close();
    db.close();
  }
});

test('M8: Orange Cat Theme tokens and stylesheet integrity', () => {
  const cssContent = readFileSync(resolve('www/index.css'), 'utf8');

  // Verify key token definitions exist
  const requiredTokens = [
    '--cat-canvas-bg',
    '--cat-ginger',
    '--cat-ginger-dark',
    '--cat-terracotta',
    '--cat-ink-primary',
    '--board-light',
    '--board-dark',
    '--board-frame',
    '--square-selected',
    '--square-last-move',
    '--font-family',
  ];

  for (const token of requiredTokens) {
    assert.ok(cssContent.includes(token), `Missing required CSS token: ${token}`);
  }

  // Verify Nunito font is imported in index.html
  const htmlContent = readFileSync(resolve('www/index.html'), 'utf8');
  assert.ok(htmlContent.includes('family=Nunito'), 'Nunito font must be referenced in index.html');
  assert.ok(htmlContent.includes('Cat Analyst'), 'Cat Analyst branding must be in index.html');
});

test('M8: Chess.com mobile theme overlay CSS integrity', () => {
  const themeCss = readFileSync(resolve('www/chesscom-theme.css'), 'utf8');
  
  assert.ok(themeCss.includes('wc-chess-board'), 'Must target wc-chess-board');
  assert.ok(themeCss.includes('chess-board'), 'Must target chess-board');
  assert.ok(themeCss.includes('--chess-analyst-accent'), 'Must define accent token');
  assert.ok(!themeCss.includes('eval'), 'Must remain theme-only without engine injection');
});


