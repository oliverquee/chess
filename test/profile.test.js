import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { getProfileStats, getSettings, setSetting } from '../storage/mobileDb.js';
import { renderProfile } from '../www/profile.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function createProfileDb() {
  const sync = new DatabaseSync(':memory:');
  sync.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE games (
      id TEXT PRIMARY KEY, date TEXT, status TEXT, result TEXT, seeded_weakness TEXT,
      assistance_level TEXT NOT NULL DEFAULT 'none', persona TEXT NULL
    );
    CREATE TABLE moves (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT REFERENCES games(id));
    CREATE TABLE move_classifications (id INTEGER PRIMARY KEY, is_current INTEGER);
    CREATE TABLE weakness_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, move_id INTEGER REFERENCES moves(id), category TEXT, classification_id INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const connection = () => ({
    async execute(sql) { sync.exec(sql); return { changes: { changes: 0 } }; },
    async run(sql, values = []) {
      const result = sync.prepare(sql).run(...values);
      return { changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) } };
    },
    async query(sql, values = []) { return { values: sync.prepare(sql).all(...values) }; },
  });
  return { sync, connection };
}

function render(stats, settings, corpusStatus = { populated: false, puzzleCount: 0, version: null }) {
  const dom = new JSDOM('<main id="profile"></main>');
  const container = dom.window.document.getElementById('profile');
  renderProfile({ container, stats, settings, corpusStatus, focus: null });
  return container;
}

test('M9 profile renders intentional empty states for a fresh database', async () => {
  const { sync, connection } = createProfileDb();
  try {
    const db = connection();
    const container = render(await getProfileStats(db), await getSettings(db));
    assert.match(container.textContent, /No sessions yet — tap Pounce on Weakness/);
    assert.match(container.textContent, /No weakness data yet/);
    assert.match(container.textContent, /Complete at least 3 sessions/);
    assert.equal(container.querySelector('[name="chesscom_username"]').value, 'lastautumnleaf1');
  } finally { sync.close(); }
});

test('M9 profile renders real aggregates and recent sessions from SQLite', async () => {
  const { sync, connection } = createProfileDb();
  try {
    sync.exec(`
      INSERT INTO games (id, date, status, result, seeded_weakness, assistance_level, persona)
      VALUES ('g1','2026-08-20T08:00:00Z','completed','1-0','tactical','none',NULL);
      INSERT INTO moves (game_id) VALUES ('g1'),('g1');
      INSERT INTO weakness_tags (move_id, category, classification_id) VALUES (1,'tactical',NULL),(2,'king_safety',NULL);
    `);
    const db = connection();
    const stats = await getProfileStats(db);
    const container = render(stats, await getSettings(db), { populated: true, puzzleCount: 7200, version: 'm9-v1' });
    assert.equal(stats.totalSessions, 1);
    assert.equal(stats.totalMoves, 2);
    assert.match(container.textContent, /7,200 puzzles/);
    assert.match(container.textContent, /Tactical/);
    assert.match(container.textContent, /2 moves/);
  } finally { sync.close(); }
});

test('M9 settings survive a simulated app connection restart', async () => {
  const { sync, connection } = createProfileDb();
  try {
    await setSetting(connection(), 'display_name', 'Pratham');
    await setSetting(connection(), 'engine_skill_level', '17');
    await setSetting(connection(), 'chesscom_username', 'lastautumnleaf1');
    const reopened = connection();
    const stored = await getSettings(reopened);
    assert.equal(stored.display_name, 'Pratham');
    assert.equal(stored.engine_skill_level, '17');
    assert.equal(stored.chesscom_username, 'lastautumnleaf1');
  } finally { sync.close(); }
});

test('animal themes render and persist as selectable profile settings', async () => {
  const { sync, connection } = createProfileDb();
  try {
    const db = connection();
    for (const theme of ['cat', 'panda', 'black-cat', 'bunny', 'fox', 'corgi', 'koala', 'raccoon', 'otter', 'red-panda']) {
      await setSetting(db, 'theme', theme);
      const settings = await getSettings(connection());
      assert.equal(settings.theme, theme);
      const container = render(await getProfileStats(db), settings);
      assert.equal(container.querySelector('[name="theme"]').value, theme);
      assert.equal(container.querySelectorAll('[name="theme"] option').length, 10);
    }
    await assert.rejects(() => setSetting(db, 'theme', 'unknown-animal'), /Unknown animal theme/);
  } finally { sync.close(); }
});

test('M9 engine difficulty reaches newly created PracticeSession instances', async () => {
  const short = { PuzzleId: 's', FEN, Moves: 'e2e4 e7e5 g1f3 b8c6', themes: ['fork'], stepCount: 4 };
  const long = { PuzzleId: 'l', FEN, Moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6', themes: ['fork'], stepCount: 8 };
  const statuses = new Map();
  const storage = {
    async getWeaknessTally() { return []; },
    async createQueuedGames(_db, games) { games.forEach((game) => statuses.set(game.id, 'queued')); },
    async transitionGameStatus(_db, id, next) { statuses.set(id, next); },
    async getGameStatus(_db, id) { return statuses.get(id); },
  };
  const puzzleLibrary = {
    async sample({ stepRange }) { return stepRange[0] === 2 ? short : long; },
    async filter() { return [short, long]; },
  };
  const orchestrator = new TrainingOrchestrator({
    db: {}, storage, puzzleLibrary,
    engineFactory: () => ({ async analyzePosition() { return {}; }, async playMove() { return null; } }),
    idFactory: ({ index }) => `difficulty-${index}`,
    skillLevel: 17,
  });
  const focus = await orchestrator.startTargetedSession();
  assert.equal(focus.activeSession.skillLevel, 17);
});
