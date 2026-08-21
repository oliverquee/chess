import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSeedScore, computeMoveAccuracy } from '../core/scoring.js';
import {
  advanceCategoryMastery,
  calculateDailyProgress,
  checkMasteryDecay,
  processDailyStreakUpdate,
} from '../core/streaks.js';

test('computeMoveAccuracy measures eval preservation', () => {
  // Good / improved moves (Stockfish score is from side-to-move perspective: next side is at -50 cp -> we are +50 cp)
  assert.equal(computeMoveAccuracy({ eval_cp_before: 20, eval_cp_after: -50 }), 100);
  assert.equal(computeMoveAccuracy({ eval_cp_before: 10, eval_cp_after: -10 }), 100);

  // Inaccuracies & drops
  const mildDrop = computeMoveAccuracy({ eval_cp_before: 100, eval_cp_after: -50 }); // delta = -(-50) - 100 = -50 cp drop -> 80%
  assert.equal(mildDrop, 80);

  const bigDrop = computeMoveAccuracy({ eval_cp_before: 100, eval_cp_after: 150 }); // delta = -150 - 100 = -250 cp drop -> 0%
  assert.equal(bigDrop, 0);
});

test('calculateSeedScore computes 60% accuracy, 30% motif, -10% hint penalty', () => {
  const perfectSession = {
    player_color: 'white',
    result: '1-0',
    hint_count: 0,
    moves: [
      { ply_number: 1, eval_cp_before: 0, eval_cp_after: -50 },
      { ply_number: 2, eval_cp_before: 50, eval_cp_after: -40 },
    ],
  };

  const score = calculateSeedScore(perfectSession);
  assert.equal(score.accuracyComponent, 60.0);
  assert.equal(score.motifComponent, 30.0);
  assert.equal(score.hintPenalty, 0.0);
  assert.equal(score.totalScore, 90.0);
  assert.equal(score.grade, 'A');

  // Session with 2 hints used
  const hintsSession = {
    ...perfectSession,
    hint_count: 2,
  };
  const hintScore = calculateSeedScore(hintsSession);
  assert.equal(hintScore.hintPenalty, 20.0);
  assert.equal(hintScore.totalScore, 70.0);
  assert.equal(hintScore.grade, 'B');
});

test('calculateDailyProgress computes goal metrics and completion status', () => {
  const p1 = calculateDailyProgress({ sessionsCompleted: 1 }, 3);
  assert.equal(p1.sessionsCompleted, 1);
  assert.equal(p1.goalTarget, 3);
  assert.equal(p1.goalMet, false);
  assert.equal(p1.percent, 33);

  const p3 = calculateDailyProgress({ sessionsCompleted: 3 }, 3);
  assert.equal(p3.goalMet, true);
  assert.equal(p3.percent, 100);
});

test('processDailyStreakUpdate respects anti-gaming floor and monthly freezes', () => {
  let state = {
    currentStreak: 0,
    longestStreak: 0,
    freezesRemaining: 2,
    freezesMonth: '2026-08',
    lastCountedDate: null,
  };

  // Day 1: Only 2 sessions completed (goal is 3) -> streak NOT incremented
  state = processDailyStreakUpdate({
    streakState: state,
    currentDate: '2026-08-01',
    sessionsCompletedToday: 2,
    goalTarget: 3,
  });
  assert.equal(state.currentStreak, 0);

  // Day 1: 3rd session completed -> streak becomes 1
  state = processDailyStreakUpdate({
    streakState: state,
    currentDate: '2026-08-01',
    sessionsCompletedToday: 3,
    goalTarget: 3,
  });
  assert.equal(state.currentStreak, 1);
  assert.equal(state.lastCountedDate, '2026-08-01');

  // Day 2: 3 sessions completed -> streak becomes 2
  state = processDailyStreakUpdate({
    streakState: state,
    currentDate: '2026-08-02',
    sessionsCompletedToday: 3,
    goalTarget: 3,
  });
  assert.equal(state.currentStreak, 2);
  assert.equal(state.longestStreak, 2);

  // Day 3 was missed!
  // Day 4: 3 sessions completed -> 1 freeze consumed, streak preserved to 3!
  state = processDailyStreakUpdate({
    streakState: state,
    currentDate: '2026-08-04',
    sessionsCompletedToday: 3,
    goalTarget: 3,
  });
  assert.equal(state.currentStreak, 3);
  assert.equal(state.freezesRemaining, 1);
  assert.equal(state.usedFreeze, true);
});

test('advanceCategoryMastery and checkMasteryDecay handle level progression and 14-day decay', () => {
  // Progression
  assert.equal(advanceCategoryMastery(0, 85), 1);
  assert.equal(advanceCategoryMastery(1, 90), 2);
  assert.equal(advanceCategoryMastery(2, 40), 2); // Score < 70 does not advance
  assert.equal(advanceCategoryMastery(5, 100), 5); // Capped at 5

  // Decay
  const masteryMap = {
    tactical: {
      category: 'tactical',
      masteryLevel: 3,
      lastPracticedAt: '2026-08-01T00:00:00.000Z',
    },
    king_safety: {
      category: 'king_safety',
      masteryLevel: 4,
      lastPracticedAt: '2026-08-18T00:00:00.000Z', // 3 days ago -> no decay
    },
  };

  // Check decay on August 21 (20 days after Aug 1 -> >14 days -> 1 level decay)
  const checked = checkMasteryDecay(masteryMap, '2026-08-21T00:00:00.000Z');
  assert.equal(checked.tactical.masteryLevel, 2);
  assert.equal(checked.king_safety.masteryLevel, 4);
});

