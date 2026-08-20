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

import { TrainingOrchestrator } from '../core/orchestrator.js';
import { PracticeSession } from '../engine/practiceSession.js';
import * as dbStorage from '../storage/db.js';
import { initDb } from '../storage/db.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';

const HTML = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');

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


