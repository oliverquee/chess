import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalBarState, evalToWinPercent, formatEvalLabel } from '../engine/evalBar.js';

test('evalToWinPercent calculates Lichess sigmoid winning probability accurately', () => {
  // Balanced position
  assert.equal(evalToWinPercent(0), 50.0);

  // Moderate advantages (+1.00 pawn / -1.00 pawn) -> ~59.1% / ~40.9%
  const plusOnePawn = evalToWinPercent(100);
  const minusOnePawn = evalToWinPercent(-100);
  assert.equal(plusOnePawn, 59.1);
  assert.equal(minusOnePawn, 40.9);
  assert.equal(Number((plusOnePawn + minusOnePawn).toFixed(1)), 100.0);

  // Decisive advantages (+5.00 pawns / -5.00 pawns)
  assert.ok(evalToWinPercent(500) > 85);
  assert.ok(evalToWinPercent(-500) < 15);

  // Mate scores
  assert.equal(evalToWinPercent(100000, true), 100);
  assert.equal(evalToWinPercent(-100000, true), 0);
  assert.equal(evalToWinPercent(99999), 100);
  assert.equal(evalToWinPercent(-99999), 0);

  // Null/undefined defaults to 50%
  assert.equal(evalToWinPercent(null), 50);
});

test('formatEvalLabel formats numerical centipawns and mate symbols', () => {
  assert.equal(formatEvalLabel(0), '0.0');
  assert.equal(formatEvalLabel(150), '+1.5');
  assert.equal(formatEvalLabel(-80), '-0.8');
  assert.equal(formatEvalLabel(100000, true), '+M');
  assert.equal(formatEvalLabel(-100000, true), '-M');
  assert.equal(formatEvalLabel(null), '0.0');
});

test('computeEvalBarState returns full UI rendering state', () => {
  const whiteAdvantage = computeEvalBarState({ evalCp: 200, isMateScore: false });
  assert.equal(whiteAdvantage.label, '+2.0');
  assert.ok(whiteAdvantage.whiteWinPercent > 65);
  assert.equal(Number((whiteAdvantage.whiteWinPercent + whiteAdvantage.blackWinPercent).toFixed(1)), 100.0);
  assert.equal(whiteAdvantage.whiteHeightPercent, whiteAdvantage.whiteWinPercent);

  const mateState = computeEvalBarState({ evalCp: 100000, isMateScore: true });
  assert.equal(mateState.label, '+M');
  assert.equal(mateState.whiteWinPercent, 100);
  assert.equal(mateState.blackWinPercent, 0);
});

