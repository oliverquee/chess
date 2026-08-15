import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalDelta } from '../engine/eval.js';

test('computeEvalDelta normalizes the post-move score back to mover perspective', () => {
  const log = {
    eval_cp_before: 50,
    eval_cp_after: -20,
    is_mate_score: 0,
  };

  // Before: +0.50 for the mover. After: -0.20 for the opponent, which is
  // +0.20 for the original mover. The move therefore lost 0.30.
  assert.equal(computeEvalDelta(log), -30);
});

test('computeEvalDelta returns null for mate sentinel scores', () => {
  assert.equal(computeEvalDelta({
    eval_cp_before: 120,
    eval_cp_after: -100000,
    is_mate_score: 1,
  }), null);
});
