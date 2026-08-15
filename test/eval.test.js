import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalDelta } from '../engine/eval.js';

test('computeEvalDelta normalizes the post-move score back to mover perspective', () => {
  const log = {
    eval_cp_before: 80,
    eval_cp_after: 20,
    is_mate_score: 0,
  };

  // Before White moves: +80 for White. After White moves, Stockfish reports
  // +20 for Black (the new side to move), which is -20 for White.
  assert.equal(computeEvalDelta(log), -100);
});

test('computeEvalDelta returns null for mate sentinel scores', () => {
  assert.equal(computeEvalDelta({
    eval_cp_before: 120,
    eval_cp_after: -100000,
    is_mate_score: 1,
  }), null);
});
