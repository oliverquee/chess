import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { downloadAndImportCorpus } from '../storage/corpusBootstrap.js';
import { MobileSqlitePuzzleLibrary } from '../storage/mobilePuzzleDb.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';

const artifactPath = resolve(process.argv[2] ?? 'artifacts/puzzles-subset.jsonl.gz');
const manifestPath = resolve(process.argv[3] ?? 'data/puzzles-subset.manifest.json');
const [compressed, manifestText] = await Promise.all([readFile(artifactPath), readFile(manifestPath, 'utf8')]);
const manifest = JSON.parse(manifestText);
const sync = new DatabaseSync(':memory:');
sync.exec('PRAGMA foreign_keys = ON;');
const db = {
  async execute(sql) { sync.exec(sql); return { changes: { changes: 0 } }; },
  async run(sql, values = []) {
    const result = sync.prepare(sql).run(...values);
    return { changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) } };
  },
  async query(sql, values = []) { return { values: sync.prepare(sql).all(...values) }; },
};

try {
  await downloadAndImportCorpus({
    db,
    manifest,
    fetchImpl: async () => new Response(compressed, { headers: { 'content-length': String(compressed.length) } }),
  });
  const statuses = new Map();
  const storage = {
    async getWeaknessTally() { return []; },
    async createQueuedGames(_db, games) { games.forEach((game) => statuses.set(game.id, 'queued')); },
    async transitionGameStatus(_db, id, next) { statuses.set(id, next); },
    async getGameStatus(_db, id) { return statuses.get(id); },
  };
  const orchestrator = new TrainingOrchestrator({
    db,
    storage,
    puzzleLibrary: new MobileSqlitePuzzleLibrary(db),
    engineFactory: () => ({ async analyzePosition() { return {}; }, async playMove() { return null; } }),
    idFactory: ({ index }) => `verify-${index}`,
  });
  const focus = await orchestrator.startTargetedSession();
  const count = Number((await db.query('SELECT COUNT(*) AS count FROM puzzles')).values[0].count);
  process.stdout.write(JSON.stringify({
    importedPuzzles: count,
    corpusVersion: manifest.version,
    firstFocus: focus.weaknessCategory,
    queuedSessions: focus.queued.length,
    activePuzzle: focus.activeSession.puzzle.PuzzleId,
  }, null, 2) + '\n');
  if (count !== manifest.puzzleCount || focus.queued.length !== 2) process.exitCode = 1;
} finally {
  sync.close();
}
