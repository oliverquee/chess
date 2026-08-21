/**
 * Build the M9 mobile puzzle corpus from the official Lichess CSV or CSV.zst.
 *
 * The selection is balanced across six seedable weakness categories, two ply
 * buckets, and four rating bands. Reservoir sampling avoids favoring rows near
 * the start of the source file while keeping memory bounded.
 *
 * Usage:
 *   node scripts/buildPuzzleSubset.js <csv-or-csv.zst-path-or-url> [output-dir]
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { Decompress } from 'fzstd';
import { THEME_TO_WEAKNESS } from '../data/themeMapping.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDABLE = Object.freeze([
  'tactical', 'king_safety', 'pawn_structure', 'piece_activity',
  'positional_judgment', 'endgame_technique',
]);
const RATING_BANDS = Object.freeze([
  { name: '800-1199', min: 800, max: 1199 },
  { name: '1200-1599', min: 1200, max: 1599 },
  { name: '1600-1899', min: 1600, max: 1899 },
  { name: '1900-2200', min: 1900, max: 2200 },
]);
const TARGET_PER_CELL = 150; // 6 categories × 2 buckets × 4 bands × 150 = 7,200

function usage() {
  throw new Error('Usage: node scripts/buildPuzzleSubset.js <csv-or-csv.zst-path-or-url> [output-dir]');
}

function cellKey(category, bucket, band) {
  return `${category}|${bucket}|${band}`;
}

function createCells() {
  const cells = new Map();
  for (const category of SEEDABLE) {
    for (const bucket of ['short', 'long']) {
      for (const band of RATING_BANDS) {
        cells.set(cellKey(category, bucket, band.name), { seen: 0, rows: [] });
      }
    }
  }
  return cells;
}

function parseRow(line) {
  const fields = line.split(',');
  if (fields.length < 8 || fields[0] === 'PuzzleId') return null;
  const [puzzleId, fen, moves, ratingText, , , , themesText] = fields;
  const movesArray = moves.trim().split(/\s+/).filter(Boolean);
  const stepCount = movesArray.length;
  const rating = Number(ratingText);
  const bucket = stepCount >= 2 && stepCount <= 6
    ? 'short'
    : stepCount >= 8 && stepCount <= 12 ? 'long' : null;
  const band = RATING_BANDS.find((candidate) => rating >= candidate.min && rating <= candidate.max);
  if (!puzzleId || !fen || !movesArray.length || !bucket || !band) return null;
  const themes = [...new Set(themesText.trim().split(/\s+/).filter(Boolean))];
  const categories = [...new Set(themes.map((theme) => THEME_TO_WEAKNESS[theme]).filter((value) => SEEDABLE.includes(value)))];
  if (!categories.length) return null;
  return { puzzleId, fen, moves, rating, stepCount, themes, bucket, band: band.name, categories };
}

function chooseCell(cells, row) {
  return row.categories
    .map((category) => ({ category, cell: cells.get(cellKey(category, row.bucket, row.band)) }))
    .sort((a, b) => a.cell.seen - b.cell.seen || a.cell.rows.length - b.cell.rows.length || a.category.localeCompare(b.category))[0];
}

function consider(cells, row) {
  const { category, cell } = chooseCell(cells, row);
  cell.seen += 1;
  const stored = {
    puzzleId: row.puzzleId,
    fen: row.fen,
    moves: row.moves,
    rating: row.rating,
    stepCount: row.stepCount,
    themes: row.themes,
    category,
    bucket: row.bucket,
    ratingBand: row.band,
  };
  if (cell.rows.length < TARGET_PER_CELL) {
    cell.rows.push(stored);
    return;
  }
  const replacement = Math.floor(Math.random() * cell.seen);
  if (replacement < TARGET_PER_CELL) cell.rows[replacement] = stored;
}

function createLineConsumer(onLine) {
  const decoder = new TextDecoder();
  let remainder = '';
  return {
    push(bytes, final = false) {
      const text = remainder + decoder.decode(bytes, { stream: !final });
      const lines = text.split(/\r?\n/);
      remainder = final ? '' : lines.pop() ?? '';
      for (const line of lines) if (line) onLine(line);
      if (final && remainder) onLine(remainder);
    },
  };
}

async function sourceStream(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Source download failed with HTTP ${response.status}.`);
    return response.body;
  }
  return createReadStream(resolve(source));
}

async function scanSource(source, onLine) {
  const input = await sourceStream(source);
  const compressed = source.toLowerCase().endsWith('.zst');
  const consumer = createLineConsumer(onLine);
  let bytesRead = 0;

  if (compressed) {
    const decompressor = new Decompress((chunk, final) => consumer.push(chunk, Boolean(final)));
    for await (const chunk of input) {
      bytesRead += chunk.length;
      decompressor.push(chunk);
      if (bytesRead % (32 * 1024 * 1024) < chunk.length) {
        process.stdout.write(`Scanned ${(bytesRead / 1024 / 1024).toFixed(0)} MiB compressed\n`);
      }
    }
    decompressor.push(new Uint8Array(0), true);
  } else {
    for await (const chunk of input) {
      bytesRead += chunk.length;
      consumer.push(chunk);
    }
    consumer.push(new Uint8Array(0), true);
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeArtifact(rows, artifactPath) {
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(artifactPath);
  gzip.pipe(output);
  for (const row of rows) {
    const payload = {
      puzzleId: row.puzzleId,
      fen: row.fen,
      moves: row.moves,
      rating: row.rating,
      stepCount: row.stepCount,
      themes: row.themes,
    };
    if (!gzip.write(`${JSON.stringify(payload)}\n`)) await once(gzip, 'drain');
  }
  gzip.end();
  await once(output, 'finish');
}

export async function buildPuzzleSubset({ source, outputDir = resolve(root, 'artifacts'), version = 'm9-v1' }) {
  if (!source) usage();
  const cells = createCells();
  let parsed = 0;
  await scanSource(source, (line) => {
    const row = parseRow(line);
    if (!row) return;
    parsed += 1;
    consider(cells, row);
  });

  const missing = [...cells.entries()].filter(([, cell]) => cell.rows.length < TARGET_PER_CELL);
  if (missing.length) {
    throw new Error(`Source could not fill ${missing.length} balance cells: ${missing.map(([key, cell]) => `${key}=${cell.rows.length}`).join(', ')}`);
  }

  const rows = [...cells.values()].flatMap((cell) => cell.rows).sort((a, b) => a.category.localeCompare(b.category)
    || a.bucket.localeCompare(b.bucket) || a.rating - b.rating || a.puzzleId.localeCompare(b.puzzleId));
  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, 'puzzles-subset.jsonl.gz');
  await writeArtifact(rows, artifactPath);
  const digest = await sha256(artifactPath);

  const counts = Object.fromEntries(SEEDABLE.map((category) => [category, {
    total: rows.filter((row) => row.category === category).length,
    short: rows.filter((row) => row.category === category && row.bucket === 'short').length,
    long: rows.filter((row) => row.category === category && row.bucket === 'long').length,
  }]));
  const manifest = {
    version,
    source: /^https?:\/\//i.test(source) ? source : basename(source),
    license: 'CC0',
    format: 'jsonl+gzip',
    puzzleCount: rows.length,
    sha256: digest,
    compressedBytes: (await readFile(artifactPath)).length,
    selection: { categories: SEEDABLE, plyBuckets: { short: [2, 6], long: [8, 12] }, ratingRange: [800, 2200] },
    counts,
    url: null,
  };
  const manifestPath = resolve(outputDir, 'puzzles-subset.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Selected ${rows.length} puzzles from ${parsed} eligible rows.\nArtifact: ${artifactPath}\nManifest: ${manifestPath}\n`);
  return { artifactPath, manifestPath, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, outputDir] = process.argv;
  await buildPuzzleSubset({ source, outputDir: outputDir ? resolve(outputDir) : undefined });
}
