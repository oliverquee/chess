import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSeedableTarget } from '../core/targeting.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { getPuzzlesForWeakness } from '../data/themeMapping.js';

const FEN = '8/8/8/8/8/8/4k3/4K3 w - - 0 1';

test('practical_time is surfaced as advice and skipped for puzzle seeding', () => {
  const calls = [];
  const result = selectSeedableTarget(
    [
      { category: 'practical_time', count: 5, rank: 1 },
      { category: 'tactical', count: 4, rank: 2 },
    ],
    {
      getPuzzles(category, bucket) {
        calls.push([category, bucket]);
        return [{ PuzzleId: 'short' }, { PuzzleId: 'long' }];
      },
    },
  );

  assert.deepEqual(calls, [['tactical', 'start-slow']]);
  assert.equal(result.weaknessCategory, 'tactical');
  assert.deepEqual(result.puzzles, [{ PuzzleId: 'short' }, { PuzzleId: 'long' }]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].category, 'practical_time');
  assert.equal(result.skipped[0].reason, 'non_seedable');
  assert.match(result.skipped[0].advice, /Slow down/i);
});

test('an empty ranking (brand-new install, zero history) bootstraps a default category instead of deadlocking', () => {
  const calls = [];
  const result = selectSeedableTarget([], {
    getPuzzles(category, bucket) {
      calls.push([category, bucket]);
      return [{ PuzzleId: 'short' }, { PuzzleId: 'long' }];
    },
  });

  assert.deepEqual(calls, [['tactical', 'start-slow']]);
  assert.equal(result.weaknessCategory, 'tactical');
  assert.equal(result.skipped.length, 0, 'bootstrap is not a skip, it is a default');
});

test('an empty ranking respects a custom bootstrapCategory option', () => {
  const result = selectSeedableTarget([], {
    bootstrapCategory: 'endgame_technique',
    getPuzzles(category) {
      assert.equal(category, 'endgame_technique');
      return [{ PuzzleId: 'a' }, { PuzzleId: 'b' }];
    },
  });
  assert.equal(result.weaknessCategory, 'endgame_technique');
});

test('a non-empty ranking is never overridden by the bootstrap, even if every entry is practical_time', () => {
  const result = selectSeedableTarget(['practical_time'], {
    getPuzzles() {
      throw new Error('must not be called');
    },
  });
  // Real (if unseedable) signal must win over the empty-history bootstrap.
  assert.equal(result.weaknessCategory, null);
  assert.equal(result.skipped[0].category, 'practical_time');
});

test('an all-practical-time ranking returns advice without crashing or inventing puzzles', () => {
  const result = selectSeedableTarget(['practical_time'], {
    getPuzzles() {
      throw new Error('must not be called');
    },
  });

  assert.equal(result.weaknessCategory, null);
  assert.deepEqual(result.puzzles, []);
  assert.equal(result.skipped[0].category, 'practical_time');
});

test('practical-time fallback selects exactly two tactical seeds from real SQLite queries', () => {
  const db = initPuzzleDb(':memory:');
  try {
    const insertPuzzle = db.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
    const insertTheme = db.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');
    insertPuzzle.run('short', FEN, 'e1d1 e2d2 d1c1 d2c2', 1200, 4);
    insertPuzzle.run('long', FEN, 'e1d1 e2d2 d1c1 d2c2 c1b1 c2b2 b1a1 b2a2', 1400, 8);
    insertTheme.run('fork', 'short');
    insertTheme.run('fork', 'long');

    const library = new SqlitePuzzleLibrary(db);
    const result = selectSeedableTarget(['practical_time', 'tactical'], {
      getPuzzles(category, bucket) {
        return getPuzzlesForWeakness(category, bucket, { library, random: () => 0 });
      },
    });

    assert.equal(result.weaknessCategory, 'tactical');
    assert.deepEqual(result.puzzles.map((puzzle) => puzzle.PuzzleId), ['short', 'long']);
    assert.equal(result.skipped[0].category, 'practical_time');
  } finally {
    db.close();
  }
});


