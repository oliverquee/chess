import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { countPuzzlePlies } from '../data/puzzleLoader.js';
import { initPuzzleDb } from '../data/puzzleDb.js';

const REQUIRED_COLUMNS = ['PuzzleId', 'FEN', 'Moves', 'Themes', 'Rating'];
const DEFAULT_BATCH_SIZE = 10000;

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

export async function importPuzzleCsv(csvPath, dbPath, {
  batchSize = DEFAULT_BATCH_SIZE,
  onProgress = null,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('batchSize must be a positive integer.');
  if (onProgress !== null && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function or null.');
  }

  const db = initPuzzleDb(dbPath);
  const upsertPuzzle = db.prepare(`
    INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(puzzle_id) DO UPDATE SET
      fen = excluded.fen,
      moves = excluded.moves,
      rating = excluded.rating,
      step_count = excluded.step_count
  `);
  const deleteThemes = db.prepare('DELETE FROM puzzle_themes WHERE puzzle_id = ?');
  const insertTheme = db.prepare('INSERT OR IGNORE INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');

  const input = createReadStream(csvPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

  let headers = null;
  let index = null;
  let imported = 0;
  let transactionOpen = false;

  const begin = () => {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
  };
  const commit = () => {
    db.exec('COMMIT');
    transactionOpen = false;
  };

  try {
    for await (const rawLine of lines) {
      const line = imported === 0 && !headers ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      if (!headers) {
        headers = parseCsvLine(line);
        index = new Map(headers.map((header, columnIndex) => [header, columnIndex]));
        const missing = REQUIRED_COLUMNS.filter((column) => !index.has(column));
        if (missing.length) throw new Error(`Puzzle CSV is missing required columns: ${missing.join(', ')}`);
        begin();
        // The corpus is rebuildable source data. Re-import must reproduce the
        // source exactly rather than retain rows removed from a newer export.
        // This delete is part of the same transaction, so failure restores the
        // previously valid corpus.
        db.exec('DELETE FROM puzzles');
        continue;
      }
      if (!line.trim()) continue;

      const columns = parseCsvLine(line);
      const puzzleId = columns[index.get('PuzzleId')] ?? '';
      const fen = columns[index.get('FEN')] ?? '';
      const moves = columns[index.get('Moves')] ?? '';
      const themesText = columns[index.get('Themes')] ?? '';
      const ratingText = columns[index.get('Rating')] ?? '';

      if (!puzzleId || !fen || !moves) {
        throw new Error(`Invalid puzzle row near imported row ${imported + 2}.`);
      }

      const rating = Number.parseInt(ratingText, 10);
      const stepCount = countPuzzlePlies(moves);
      upsertPuzzle.run(puzzleId, fen, moves, Number.isInteger(rating) ? rating : null, stepCount);
      deleteThemes.run(puzzleId);

      for (const theme of themesText.trim().split(/\s+/).filter(Boolean)) {
        insertTheme.run(theme, puzzleId);
      }

      imported += 1;
      if (onProgress && imported % batchSize === 0) onProgress(imported);
    }

    if (!headers) throw new Error('Puzzle CSV is empty.');
    if (transactionOpen) commit();
    if (onProgress && imported % batchSize !== 0) onProgress(imported);
    db.exec('ANALYZE');
    return imported;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the import failure.
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

async function main() {
  const [, , csvArg, dbArg] = process.argv;
  if (!csvArg || !dbArg) {
    throw new Error('Usage: node scripts/importPuzzles.js <lichess_db_puzzle.csv> <output.sqlite>');
  }

  const csvPath = resolve(csvArg);
  const dbPath = resolve(dbArg);
  const imported = await importPuzzleCsv(csvPath, dbPath);
  console.log(`Imported ${imported} puzzles into ${dbPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
