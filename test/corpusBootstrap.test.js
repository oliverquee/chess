import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { downloadAndImportCorpus, getCorpusStatus } from '../storage/corpusBootstrap.js';
import { MobileSqlitePuzzleLibrary } from '../storage/mobilePuzzleDb.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const RECORDS = [
  { puzzleId: 'm9-short', fen: RAW_FEN, moves: 'e2e4 e7e5 g1f3 b8c6', rating: 1100, stepCount: 4, themes: ['fork'] },
  { puzzleId: 'm9-long', fen: RAW_FEN, moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6', rating: 1700, stepCount: 8, themes: ['fork'] },
];

function artifact(records = RECORDS) {
  const compressed = gzipSync(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return {
    compressed,
    manifest: {
      version: 'test-v1',
      puzzleCount: records.length,
      sha256: createHash('sha256').update(compressed).digest('hex'),
      url: 'https://example.test/puzzles-subset.jsonl.gz',
    },
  };
}

function createDb({ failAfterPuzzles = Number.POSITIVE_INFINITY } = {}) {
  const sync = new DatabaseSync(':memory:');
  sync.exec('PRAGMA foreign_keys = ON;');
  let puzzleInserts = 0;
  return {
    async execute(sql) { sync.exec(sql); return { changes: { changes: 0 } }; },
    async run(sql, values = []) {
      if (/INSERT INTO puzzles/i.test(sql)) {
        puzzleInserts += 1;
        if (puzzleInserts > failAfterPuzzles) throw new Error('simulated interrupted import');
      }
      const result = sync.prepare(sql).run(...values);
      return { changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) } };
    },
    async query(sql, values = []) { return { values: sync.prepare(sql).all(...values) }; },
    close() { sync.close(); },
  };
}

function fetchArtifact(compressed, counter = { calls: 0 }) {
  return async () => {
    counter.calls += 1;
    return new Response(compressed, { status: 200, headers: { 'content-length': String(compressed.length) } });
  };
}

test('M9 corpus import verifies the artifact and populates real SQLite', async () => {
  const db = createDb();
  const { compressed, manifest } = artifact();
  try {
    const phases = [];
    const result = await downloadAndImportCorpus({
      db,
      manifest,
      fetchImpl: fetchArtifact(compressed),
      onProgress: ({ phase }) => phases.push(phase),
    });
    assert.equal(result.puzzleCount, 2);
    assert.equal(result.version, 'test-v1');
    assert.equal(result.populated, true);
    assert.ok(phases.includes('download'));
    assert.ok(phases.includes('verify'));
    assert.ok(phases.includes('import'));
  } finally { db.close(); }
});

test('M9 interrupted import rolls back every puzzle row', async () => {
  const db = createDb({ failAfterPuzzles: 1 });
  const { compressed, manifest } = artifact();
  try {
    await assert.rejects(
      downloadAndImportCorpus({ db, manifest, fetchImpl: fetchArtifact(compressed) }),
      /simulated interrupted import/,
    );
    assert.equal((await getCorpusStatus(db)).puzzleCount, 0);
  } finally { db.close(); }
});

test('M9 checksum mismatch is rejected before SQLite import', async () => {
  const db = createDb();
  const { compressed, manifest } = artifact();
  try {
    await assert.rejects(
      downloadAndImportCorpus({ db, manifest: { ...manifest, sha256: '0'.repeat(64) }, fetchImpl: fetchArtifact(compressed) }),
      /checksum mismatch/,
    );
    assert.equal((await getCorpusStatus(db)).puzzleCount, 0);
  } finally { db.close(); }
});

test('M9 no-network failure leaves the corpus empty and retryable', async () => {
  const db = createDb();
  const { manifest } = artifact();
  try {
    await assert.rejects(
      downloadAndImportCorpus({ db, manifest, fetchImpl: async () => { throw new Error('offline'); } }),
      /offline/,
    );
    assert.equal((await getCorpusStatus(db)).puzzleCount, 0);
  } finally { db.close(); }
});

test('M9 mid-download network drop leaves the corpus empty', async () => {
  const db = createDb();
  const { compressed, manifest } = artifact();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(compressed.subarray(0, Math.floor(compressed.length / 2)));
      controller.error(new Error('network dropped'));
    },
  });
  try {
    await assert.rejects(
      downloadAndImportCorpus({
        db,
        manifest,
        fetchImpl: async () => new Response(stream, { headers: { 'content-length': String(compressed.length) } }),
      }),
      /network dropped/,
    );
    assert.equal((await getCorpusStatus(db)).puzzleCount, 0);
  } finally { db.close(); }
});

test('M9 second launch skips download when the installed corpus version matches', async () => {
  const db = createDb();
  const { compressed, manifest } = artifact();
  const counter = { calls: 0 };
  const fetchImpl = fetchArtifact(compressed, counter);
  try {
    await downloadAndImportCorpus({ db, manifest, fetchImpl });
    const second = await downloadAndImportCorpus({ db, manifest, fetchImpl });
    assert.equal(second.skipped, true);
    assert.equal(counter.calls, 1);
  } finally { db.close(); }
});

test('M9 imported corpus starts a real targeted session on zero history', async () => {
  const db = createDb();
  const { compressed, manifest } = artifact();
  const statuses = new Map();
  const storage = {
    async getWeaknessTally() { return []; },
    async createQueuedGames(_db, games) { for (const game of games) statuses.set(game.id, 'queued'); },
    async transitionGameStatus(_db, id, next) { statuses.set(id, next); },
    async getGameStatus(_db, id) { return statuses.get(id); },
  };
  try {
    await downloadAndImportCorpus({ db, manifest, fetchImpl: fetchArtifact(compressed) });
    const orchestrator = new TrainingOrchestrator({
      db,
      storage,
      puzzleLibrary: new MobileSqlitePuzzleLibrary(db),
      engineFactory: () => ({ async analyzePosition() { return {}; }, async playMove() { return null; } }),
      idFactory: ({ index }) => `fresh-${index}`,
    });
    const focus = await orchestrator.startTargetedSession();
    assert.equal(focus.weaknessCategory, 'tactical');
    assert.ok(focus.activeSession);
    assert.equal(focus.queued.length, 2);
  } finally { db.close(); }
});
