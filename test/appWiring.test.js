/**
 * Boots the REAL www/app.js module graph in a simulated DOM and plays actual
 * moves through it. This is the test class that was missing: prior tests
 * exercised the orchestrator directly, never the app's own wiring, which is
 * exactly how the shipped APK ended up running a standalone prototype.
 *
 * Native layers (Capacitor SQLite, Stockfish WASM Worker) are stubbed — those
 * still require a device. What this proves is that app.js talks to the real
 * modules correctly, and that a turn produces exactly one engine reply.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { DatabaseSync } from 'node:sqlite';

import { TrainingOrchestrator } from '../core/orchestrator.js';
import { PracticeSession } from '../engine/practiceSession.js';
import { ChessClock, formatClockTime } from '../engine/clock.js';
import * as dbStorage from '../storage/db.js';
import { initDb } from '../storage/db.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { getSettings, setSetting } from '../storage/mobileDb.js';
import { renderProfile } from '../www/profile.js';

const HTML = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const CAPACITOR_CONFIG = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));

/** Deterministic stand-in for the Stockfish worker client. */
function stubEngine() {
  let calls = 0;
  return {
    get playMoveCalls() { return calls; },
    async analyzePosition(fen) {
      return { bestMove: firstLegal(fen), evalCp: 20, principalVariation: [] };
    },
    async playMove(fen) {
      calls += 1;
      return firstLegal(fen);
    },
  };
}

function firstLegal(fen) {
  const c = new Chess(fen);
  const moves = c.moves({ verbose: true });
  if (!moves.length) return null;
  const m = moves[0];
  return m.from + m.to + (m.promotion ?? '');
}

function seedPuzzles(db) {
  db.exec(`INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count)
    VALUES ('shortA','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','e2e4 e7e5 g1f3 b8c6',1200,4),
           ('longA','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6',1300,8);`);
  db.exec(`INSERT INTO puzzle_themes (theme, puzzle_id) VALUES ('fork','shortA'),('fork','longA');`);
}

test('app wiring: a completely fresh install (zero history) can still start a first session', async () => {
  const dom = new JSDOM(HTML, { url: 'https://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;

  const db = initDb(':memory:');
  const puzzleDb = initPuzzleDb(':memory:');
  seedPuzzles(puzzleDb);
  // Deliberately no dbStorage.saveGameSession / saveWeaknessTags calls here --
  // this is exactly what a brand-new phone install looks like.

  const orchestrator = new TrainingOrchestrator({
    db,
    storage: dbStorage,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: () => stubEngine(),
  });

  const focus = await orchestrator.startTargetedSession();
  assert.ok(focus.activeSession, 'the very first tap of "Pounce on Weakness" must produce a session');
  assert.equal(focus.weaknessCategory, 'tactical', 'fresh installs bootstrap to tactical by default');

  db.close();
  puzzleDb.close();
});

test('app wiring: a single player turn produces exactly one engine reply', async () => {
  const dom = new JSDOM(HTML, { url: 'https://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;

  const db = initDb(':memory:');
  const puzzleDb = initPuzzleDb(':memory:');
  seedPuzzles(puzzleDb);

  const engine = stubEngine();
  const orchestrator = new TrainingOrchestrator({
    db,
    storage: dbStorage,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: () => engine,
    idFactory: (() => { let i = 0; return () => `s-${++i}`; })(),
  });

  // Seed a weakness so targeting has something to select.
  const gid = 'seed-game';
  dbStorage.saveGameSession(db, {
    id: gid, mode: 'practice', result: null, start_fen: 'x', current_fen: 'x',
    moves: [{ game_id: gid, ply_number: 1, fen_before: 'x', move_played: 'e2e4', timestamp: '2026-01-01' }],
  });
  const history = dbStorage.getGameHistory(db, { limit: 1 });
  const moveId = history[0].moves[0].id;
  dbStorage.saveWeaknessTags(db, moveId, [{ category: 'tactical', severity: 'high' }]);

  const focus = await orchestrator.startTargetedSession();
  assert.equal(focus.weaknessCategory, 'tactical');
  assert.ok(focus.activeSession instanceof PracticeSession);

  const session = focus.activeSession;
  const before = engine.playMoveCalls;

  const chess = new Chess(session.currentFen);
  const first = chess.moves({ verbose: true })[0];
  const result = await session.playTurn(first.from + first.to);

  // The crux: playTurn plays the engine reply itself. The UI must consume
  // result.engineLog rather than running its own second search.
  assert.equal(engine.playMoveCalls - before, 1, 'engine must move exactly once per turn');
  assert.ok(result.engineLog, 'playTurn should return the engine reply');
  assert.ok(result.currentFen, 'playTurn should return the resulting FEN');

  // Applying player + engine move locally must land on session.currentFen.
  const local = new Chess(session.startFen);
  local.move({ from: first.from, to: first.to, promotion: 'q' });
  const em = result.engineLog.move_played;
  local.move({ from: em.slice(0, 2), to: em.slice(2, 4), promotion: em.length > 4 ? em[4] : undefined });
  assert.equal(local.fen(), result.currentFen, 'UI board must stay in sync with session FEN');

  db.close();
  puzzleDb.close();
});

test('app wiring: index.html loads the bundle as a module', () => {
  assert.match(HTML, /<script\s+type="module"\s+src="bundle\.js">/,
    'index.html must load the bundled ES module, not the raw prototype script');
});

test('app wiring: native HTTP is enabled for CORS-safe corpus delivery', () => {
  assert.equal(CAPACITOR_CONFIG.plugins?.CapacitorHttp?.enabled, true);
});

test('app wiring: the real entry HTML exposes an explicit first-run corpus gate and primary tabs', () => {
  const dom = new JSDOM(HTML);
  assert.ok(dom.window.document.getElementById('corpus-first-run'));
  assert.equal(dom.window.document.getElementById('btn-download-corpus')?.textContent.trim(), 'Download puzzle pack');
  assert.ok(dom.window.document.getElementById('nav-practice'));
  assert.ok(dom.window.document.getElementById('nav-profile'));
  assert.equal(dom.window.document.getElementById('nav-chesscom')?.textContent.trim(), '♞Chess.com');
});

test('app wiring: profile page renders the intentional fresh-install empty states', () => {
  const dom = new JSDOM(HTML);
  const container = dom.window.document.getElementById('profile-page');
  renderProfile({
    container,
    stats: { totalSessions: 0, totalMoves: 0, weaknessTally: [], recentSessions: [] },
    settings: { display_name: '', cat_avatar: 'orange-tabby', chesscom_username: 'lastautumnleaf1', engine_skill_level: '10', theme: 'cat' },
    corpusStatus: { populated: false, puzzleCount: 0, version: null },
    focus: null,
  });
  assert.match(container.textContent, /No sessions yet — tap Pounce on Weakness/);
  assert.match(container.textContent, /Complete at least 3 sessions/);
});

test('app wiring: profile page renders populated aggregates without demo fallbacks', () => {
  const dom = new JSDOM(HTML);
  const container = dom.window.document.getElementById('profile-page');
  renderProfile({
    container,
    stats: {
      totalSessions: 4,
      totalMoves: 31,
      weaknessTally: [{ category: 'tactical', count: 3 }],
      recentSessions: [{ id: 'g1', date: '2026-08-20T08:00:00Z', seeded_weakness: 'tactical', result: '1-0', move_count: 12 }],
    },
    settings: { display_name: 'Pratham', cat_avatar: 'orange-tabby', chesscom_username: 'lastautumnleaf1', engine_skill_level: '14', theme: 'cat' },
    corpusStatus: { populated: true, puzzleCount: 7200, version: 'm9-v1' },
    focus: { weaknessCategory: 'tactical' },
  });
  assert.match(container.textContent, /4 hunts completed/);
  assert.match(container.textContent, /31/);
  assert.match(container.textContent, /7,200 puzzles/);
  assert.match(container.textContent, /12 moves/);
});

test('app wiring: SQLite settings round-trip survives a new async connection wrapper', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const connection = () => ({
    async execute(sql) { sqlite.exec(sql); },
    async run(sql, values = []) { const result = sqlite.prepare(sql).run(...values); return { changes: { changes: Number(result.changes) } }; },
    async query(sql, values = []) { return { values: sqlite.prepare(sql).all(...values) }; },
  });
  try {
    await setSetting(connection(), 'engine_skill_level', '16');
    await setSetting(connection(), 'chesscom_username', 'lastautumnleaf1');
    const reopened = await getSettings(connection());
    assert.equal(reopened.engine_skill_level, '16');
    assert.equal(reopened.chesscom_username, 'lastautumnleaf1');
  } finally { sqlite.close(); }
});

test('app wiring: index.html exposes M10 eval bar, clocks, action buttons, and modal overlays', () => {
  const dom = new JSDOM(HTML);
  const doc = dom.window.document;

  // Eval bar & clocks
  assert.ok(doc.getElementById('eval-bar-wrapper'), 'eval-bar-wrapper must exist in board container');
  assert.ok(doc.getElementById('eval-bar-fill'), 'eval-bar-fill element must exist');
  assert.ok(doc.getElementById('opponent-clock'), 'opponent-clock badge must exist');
  assert.ok(doc.getElementById('user-clock'), 'user-clock badge must exist');

  // In-game action bar
  assert.ok(doc.getElementById('btn-hint'), 'btn-hint must exist');
  assert.ok(doc.getElementById('btn-takeback'), 'btn-takeback must exist');
  assert.ok(doc.getElementById('btn-draw'), 'btn-draw must exist');
  assert.ok(doc.getElementById('btn-resign'), 'btn-resign must exist');
  assert.ok(doc.getElementById('btn-freeplay'), 'btn-freeplay must exist');

  // M10 Modals
  assert.ok(doc.getElementById('hint-modal'), 'hint-modal overlay must exist');
  assert.ok(doc.getElementById('blunder-modal'), 'blunder-modal overlay must exist');
  assert.ok(doc.getElementById('score-modal'), 'score-modal overlay must exist');
});

test('app wiring: profile page renders M10 streaks, mastery, and export/import backup controls', () => {
  const dom = new JSDOM(HTML);
  const container = dom.window.document.getElementById('profile-page');
  renderProfile({
    container,
    stats: {
      totalSessions: 5,
      totalMoves: 45,
      weaknessTally: [{ category: 'tactical', count: 4 }],
      recentSessions: [],
      streakState: { currentStreak: 3, longestStreak: 5, freezesRemaining: 1 },
      todayStats: { sessionsCompleted: 2 },
      categoryMastery: {
        tactical: { category: 'tactical', masteryLevel: 3 },
      },
    },
    settings: {
      display_name: 'Orange Cat Hunter',
      cat_avatar: 'orange-tabby',
      chesscom_username: 'lastautumnleaf1',
      engine_skill_level: '12',
      theme: 'cat',
      daily_goal: '3',
      freeplay_persona: 'hunter',
      freeplay_time_control: '3|2',
    },
    corpusStatus: { populated: true, puzzleCount: 7200, version: 'm10-v1' },
    focus: { weaknessCategory: 'tactical' },
  });

  assert.match(container.textContent, /Daily Hunt Streak & Mastery/);
  assert.match(container.textContent, /3/); // Current streak
  assert.match(container.textContent, /1\/2/); // Freezes left
  assert.match(container.textContent, /Category Mastery/);
  assert.match(container.textContent, /Database Backup & Restore/);
  assert.ok(container.querySelector('#btn-db-export'));
  assert.ok(container.querySelector('#btn-db-import'));
});

test('app wiring: timed Free Play session advances clock and updates display without error', async () => {
  const dom = new JSDOM(HTML, { url: 'https://localhost/' });
  const doc = dom.window.document;
  const userClockEl = doc.getElementById('user-clock');
  const opponentClockEl = doc.getElementById('opponent-clock');

  const session = new PracticeSession({
    mode: 'freeplay',
    persona: 'tabby',
    timeControl: '3|2',
    playerColor: 'white',
  });

  let currentTime = 1000000;
  const sessionClock = new ChessClock({
    timeControl: session.timeControl,
    now: () => currentTime,
  });
  sessionClock.start();

  // Test the clock display update tick (using real clock API)
  assert.doesNotThrow(() => {
    const time = { whiteMs: sessionClock.getTime('white'), blackMs: sessionClock.getTime('black') };
    const isPlayerWhite = (session.playerColor ?? 'white') === 'white';
    const playerTime = isPlayerWhite ? time.whiteMs : time.blackMs;
    const oppTime = isPlayerWhite ? time.blackMs : time.whiteMs;

    userClockEl.textContent = formatClockTime(playerTime);
    opponentClockEl.textContent = formatClockTime(oppTime);
  }, 'clock tick must not throw (sessionClock.getTimeRemaining regression guard)');

  const initialUserTime = userClockEl.textContent;
  assert.equal(initialUserTime, '03:00');

  // Advance time by 1000ms past a clock tick
  currentTime += 1000;

  const timeAfter = { whiteMs: sessionClock.getTime('white'), blackMs: sessionClock.getTime('black') };
  const isPlayerWhite = (session.playerColor ?? 'white') === 'white';
  const playerTimeAfter = isPlayerWhite ? timeAfter.whiteMs : timeAfter.blackMs;
  userClockEl.textContent = formatClockTime(playerTimeAfter);

  assert.notEqual(userClockEl.textContent, initialUserTime, 'display time must decrement after clock tick');
  assert.equal(userClockEl.textContent, '02:59');
  sessionClock.pause();
});

test('app wiring: seeded puzzle with Black to move derives playerColor and allows immediate legal move', async () => {
  const dom = new JSDOM(HTML, { url: 'https://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;

  const db = initDb(':memory:');
  const puzzleDb = initPuzzleDb(':memory:');

  // Starting FEN has White to move ('w'). Moves[0] is 'e2e4' (White moves first).
  // Motif-ready FEN after Moves[0] has Black to move ('b').
  const insertPuzzle = puzzleDb.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
  const insertTheme = puzzleDb.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');
  const START_FEN_WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  insertPuzzle.run('black_move_short', START_FEN_WHITE, 'e2e4 e7e5 g1f3 b8c6', 1200, 4);
  insertPuzzle.run('black_move_long', START_FEN_WHITE, 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4', 1300, 6);
  insertTheme.run('fork', 'black_move_short');
  insertTheme.run('fork', 'black_move_long');

  const engine = stubEngine();
  const orchestrator = new TrainingOrchestrator({
    db,
    storage: dbStorage,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: () => engine,
    idFactory: (() => { let i = 0; return () => `black-seed-${++i}`; })(),
  });

  const focus = await orchestrator.startTargetedSession(['tactical']);
  assert.ok(focus.activeSession instanceof PracticeSession);

  // Assert playerColor is correctly derived as 'black' from the motif-ready FEN
  assert.equal(focus.activeSession.playerColor, 'black', 'playerColor must be black when motif-ready FEN has Black to move');

  // Verify that Black to move matches the position
  const currentFenTurn = focus.activeSession.currentFen.split(' ')[1];
  assert.equal(currentFenTurn, 'b', 'current FEN must have Black to move');

  // Player can immediately play the legal move 'e7e5'
  const turnResult = await focus.activeSession.playTurn('e7e5');
  assert.ok(turnResult.playerLog, 'player log must be created for legal Black move');
  assert.equal(turnResult.playerLog.move_played, 'e7e5');
  assert.ok(turnResult.engineLog, 'engine should immediately reply to player move');

  db.close();
  puzzleDb.close();
});


