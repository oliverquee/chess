import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MobileSqlitePuzzleLibrary } from '../storage/mobilePuzzleDb.js';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PUZZLE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating INTEGER,
  step_count INTEGER NOT NULL CHECK(step_count > 0)
);

CREATE TABLE IF NOT EXISTS puzzle_themes (
  theme TEXT NOT NULL,
  puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
  PRIMARY KEY (theme, puzzle_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_puzzles_step_count ON puzzles(step_count);
CREATE INDEX IF NOT EXISTS idx_puzzle_themes_puzzle_id ON puzzle_themes(puzzle_id);
`;

function createMockCapacitorPuzzleDb() {
  const syncDb = new DatabaseSync(':memory:');
  syncDb.exec('PRAGMA foreign_keys = ON;');
  const statements = PUZZLE_SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    syncDb.exec(statement + ';');
  }

  return {
    async execute(sql) {
      syncDb.exec(sql);
      return { changes: { changes: 0 } };
    },
    async run(sql, values = []) {
      const stmt = syncDb.prepare(sql);
      const result = stmt.run(...values);
      return {
        changes: {
          changes: Number(result.changes),
          lastId: Number(result.lastInsertRowid),
        },
      };
    },
    async query(sql, values = []) {
      const stmt = syncDb.prepare(sql);
      const rows = stmt.all(...values);
      return { values: rows };
    },
    close() {
      syncDb.close();
    },
  };
}

test('mobilePuzzleDb: MobileSqlitePuzzleLibrary filters, samples and finds longest puzzle asynchronously', async () => {
  const db = createMockCapacitorPuzzleDb();
  try {
    await db.run(
      'INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)',
      ['short_1', FEN, 'e2e4 e7e5 g1f3 b8c6', 1100, 4],
    );
    await db.run(
      'INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)',
      ['long_1', FEN, 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6', 1500, 8],
    );
    await db.run(
      'INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)',
      ['fork', 'short_1'],
    );
    await db.run(
      'INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)',
      ['fork', 'long_1'],
    );

    const library = new MobileSqlitePuzzleLibrary(db);

    const shortFiltered = await library.filter({ themeTags: ['fork'], stepRange: [2, 6] });
    assert.equal(shortFiltered.length, 1);
    assert.equal(shortFiltered[0].PuzzleId, 'short_1');
    assert.equal(shortFiltered[0].stepCount, 4);

    const sampled = await library.sample({ themeTags: ['fork'], stepRange: [8, 12] });
    assert.ok(sampled);
    assert.equal(sampled.PuzzleId, 'long_1');

    const longest = await library.findLongest({ themeTags: ['fork'] });
    assert.ok(longest);
    assert.equal(longest.PuzzleId, 'long_1');
    assert.equal(longest.stepCount, 8);
  } finally {
    db.close();
  }
});
