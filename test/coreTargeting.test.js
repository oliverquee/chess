import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSeedableTarget } from '../core/targeting.js';

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
