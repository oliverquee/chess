import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPuzzleDb, openPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { importPuzzleCsv } from '../scripts/importPuzzles.js';

const FEN = '8/8/8/8/8/8/4k3/4K3 w - - 0 1';

test('SqlitePuzzleLibrary samples by theme/ply range and finds longest fallback', () => {
  const db = initPuzzleDb(':memory:');
  try {
    const insertPuzzle = db.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
    const insertTheme = db.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');

    insertPuzzle.run('p4', FEN, 'e1d1 e2d2 d1c1 d2c2', 1200, 4);
    insertPuzzle.run('p6', FEN, 'e1d1 e2d2 d1c1 d2c2 c1b1 c2b2', 1300, 6);
    insertPuzzle.run('p8', FEN, 'e1d1 e2d2 d1c1 d2c2 c1b1 c2b2 b1a1 b2a2', 1400, 8);
    for (const id of ['p4', 'p6', 'p8']) insertTheme.run('fork', id);

    const library = new SqlitePuzzleLibrary(db);
    assert.equal(library.sample({ themeTags: ['fork'], stepRange: [2, 6] }, () => 0).PuzzleId, 'p4');
    assert.equal(library.sample({ themeTags: ['fork'], stepRange: [8, 12] }, () => 0).PuzzleId, 'p8');
    assert.equal(library.findLongest({ themeTags: ['fork'] }).PuzzleId, 'p8');
  } finally {
    db.close();
  }
});

test('streaming importer creates a queryable SQLite puzzle database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-puzzle-import-'));
  const csvPath = join(dir, 'puzzles.csv');
  const dbPath = join(dir, 'puzzles.sqlite');
  writeFileSync(csvPath, `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate\np1,${FEN},e1d1 e2d2 d1c1 d2c2,1200,80,90,12,fork short,https://lichess.org/a,,\np2,${FEN},e1d1 e2d2 d1c1 d2c2 c1b1 c2b2 b1a1 b2a2,1500,80,90,12,pin long,https://lichess.org/b,,\n`);

  try {
    assert.equal(await importPuzzleCsv(csvPath, dbPath, { batchSize: 1 }), 2);

    const db = openPuzzleDb(dbPath);
    try {
      const library = new SqlitePuzzleLibrary(db);
      const short = library.sample({ themeTags: ['fork'], stepRange: [2, 6] }, () => 0);
      const long = library.sample({ themeTags: ['pin'], stepRange: [8, 12] }, () => 0);
      assert.equal(short.PuzzleId, 'p1');
      assert.equal(short.stepCount, 4);
      assert.equal(long.PuzzleId, 'p2');
      assert.equal(long.stepCount, 8);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streaming importer rolls back every row when a later row is invalid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-puzzle-import-atomic-'));
  const csvPath = join(dir, 'puzzles.csv');
  const dbPath = join(dir, 'puzzles.sqlite');
  writeFileSync(csvPath, `PuzzleId,FEN,Moves,Rating,Themes\np1,${FEN},e1d1 e2d2,1200,fork\np2,,e1d1 e2d2,1300,pin\n`);

  try {
    const existing = initPuzzleDb(dbPath);
    existing.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)')
      .run('existing', FEN, 'e1d1 e2d2', 1100, 2);
    existing.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)')
      .run('fork', 'existing');
    existing.close();

    await assert.rejects(
      () => importPuzzleCsv(csvPath, dbPath, { batchSize: 1 }),
      /Invalid puzzle row/,
    );

    const db = openPuzzleDb(dbPath);
    try {
      assert.deepEqual(
        db.prepare('SELECT puzzle_id FROM puzzles ORDER BY puzzle_id').all().map((row) => row.puzzle_id),
        ['existing'],
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM puzzle_themes').get().count, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
