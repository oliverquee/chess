const PUZZLE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS puzzles (
    puzzle_id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER,
    step_count INTEGER NOT NULL CHECK(step_count > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS puzzle_themes (
    theme TEXT NOT NULL,
    puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
    PRIMARY KEY (theme, puzzle_id)
  ) WITHOUT ROWID`,
  'CREATE INDEX IF NOT EXISTS idx_puzzles_step_count ON puzzles(step_count)',
  'CREATE INDEX IF NOT EXISTS idx_puzzle_themes_puzzle_id ON puzzle_themes(puzzle_id)',
  `CREATE TABLE IF NOT EXISTS corpus_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

function assertDb(db) {
  if (!db?.execute || !db?.run || !db?.query) {
    throw new TypeError('db must be an async SQLite connection.');
  }
}

export async function ensureCorpusSchema(db) {
  assertDb(db);
  await db.execute('PRAGMA foreign_keys = ON;');
  for (const statement of PUZZLE_SCHEMA) await db.execute(`${statement};`);
}

export async function getCorpusStatus(db) {
  assertDb(db);
  await ensureCorpusSchema(db);
  const countRes = await db.query('SELECT COUNT(*) AS count FROM puzzles');
  const metaRes = await db.query("SELECT key, value FROM corpus_meta WHERE key IN ('corpus_version', 'corpus_sha256')");
  const meta = Object.fromEntries((metaRes.values || []).map((row) => [row.key, row.value]));
  return {
    populated: Number(countRes.values?.[0]?.count ?? 0) > 0,
    puzzleCount: Number(countRes.values?.[0]?.count ?? 0),
    version: meta.corpus_version ?? null,
    sha256: meta.corpus_sha256 ?? null,
  };
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readResponseBytes(response, onProgress) {
  if (!response.ok) throw new Error(`Corpus download failed with HTTP ${response.status}.`);
  const total = Number(response.headers.get('content-length') || 0);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ phase: 'download', loaded: bytes.length, total, percent: total ? 100 : null });
    return bytes;
  }

  const chunks = [];
  let loaded = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      phase: 'download',
      loaded,
      total,
      percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null,
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This WebView does not support gzip decompression.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function validatePuzzle(record) {
  if (!record || typeof record !== 'object') throw new Error('Corpus row must be an object.');
  for (const field of ['puzzleId', 'fen', 'moves']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      throw new Error(`Corpus row has an invalid ${field}.`);
    }
  }
  if (!Number.isInteger(record.stepCount) || record.stepCount < 1) {
    throw new Error(`Corpus row ${record.puzzleId} has an invalid stepCount.`);
  }
  if (!Array.isArray(record.themes) || record.themes.some((theme) => typeof theme !== 'string' || !theme)) {
    throw new Error(`Corpus row ${record.puzzleId} has invalid themes.`);
  }
}

async function importRows(db, text, manifest, onProgress) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length !== manifest.puzzleCount) {
    throw new Error(`Corpus count mismatch: manifest=${manifest.puzzleCount}, artifact=${lines.length}.`);
  }

  await db.execute('BEGIN IMMEDIATE;');
  try {
    await db.execute('DELETE FROM puzzle_themes;');
    await db.execute('DELETE FROM puzzles;');
    for (let index = 0; index < lines.length; index += 1) {
      const record = JSON.parse(lines[index]);
      validatePuzzle(record);
      await db.run(
        'INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)',
        [record.puzzleId, record.fen, record.moves, record.rating ?? null, record.stepCount],
      );
      for (const theme of [...new Set(record.themes)]) {
        await db.run('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)', [theme, record.puzzleId]);
      }
      if ((index + 1) % 100 === 0 || index + 1 === lines.length) {
        onProgress?.({
          phase: 'import',
          loaded: index + 1,
          total: lines.length,
          percent: Math.round(((index + 1) / lines.length) * 100),
        });
      }
    }
    await db.run(`
      INSERT INTO corpus_meta (key, value) VALUES ('corpus_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [manifest.version]);
    await db.run(`
      INSERT INTO corpus_meta (key, value) VALUES ('corpus_sha256', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [manifest.sha256.toLowerCase()]);
    await db.execute('COMMIT;');
  } catch (error) {
    try { await db.execute('ROLLBACK;'); } catch {}
    throw error;
  }
}

export async function downloadAndImportCorpus({
  db,
  manifest,
  fetchImpl = globalThis.fetch,
  onProgress,
  force = false,
}) {
  assertDb(db);
  if (!manifest?.url || !manifest?.sha256 || !manifest?.version || !Number.isInteger(manifest?.puzzleCount)) {
    throw new TypeError('A complete corpus manifest is required.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');

  const current = await getCorpusStatus(db);
  if (!force && current.populated && current.version === manifest.version) {
    return { ...current, skipped: true };
  }

  const response = await fetchImpl(manifest.url);
  const compressed = await readResponseBytes(response, onProgress);
  const digest = hex(await crypto.subtle.digest('SHA-256', compressed));
  if (digest !== manifest.sha256.toLowerCase()) {
    throw new Error(`Corpus checksum mismatch: expected ${manifest.sha256.toLowerCase()}, received ${digest}.`);
  }
  onProgress?.({ phase: 'verify', loaded: compressed.length, total: compressed.length, percent: 100 });

  const text = await decompressGzip(compressed);
  await importRows(db, text, manifest, onProgress);
  return { ...(await getCorpusStatus(db)), skipped: false };
}
