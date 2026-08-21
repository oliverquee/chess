import { computeEvalDelta } from '../engine/eval.js';

/**
 * Computes individual move accuracy percentage (0 - 100) from evaluation delta.
 */
export function computeMoveAccuracy(log) {
  if (!log || typeof log !== 'object') return 100;
  const delta = computeEvalDelta(log);
  if (delta === null || delta === undefined) return 100;

  // delta > 0 is good (advantage increased or kept)
  if (delta >= 0) return 100;

  // delta < 0 is an error / drop (e.g. -50 cp drop -> 80% accuracy, -200 cp -> 20%)
  const loss = Math.abs(delta);
  const accuracy = Math.max(0, 100 - loss * 0.4);
  return Number(accuracy.toFixed(1));
}

/**
 * Calculates seed round score:
 * - Accuracy Component (60% weight, max 60 pts)
 * - Motif Component (30% weight, max 30 pts)
 * - Hint Penalty (-10 pts per hint, max -30 pts)
 */
export function calculateSeedScore(sessionSummary) {
  if (!sessionSummary || typeof sessionSummary !== 'object') {
    return {
      accuracyComponent: 0,
      motifComponent: 0,
      hintPenalty: 0,
      totalScore: 0,
      grade: 'D',
    };
  }

  const moves = Array.isArray(sessionSummary.moves) ? sessionSummary.moves : [];
  const playerColor = sessionSummary.player_color || 'white';
  const playerMoves = moves.filter((m) => {
    const isPlayer = playerColor === 'white' ? m.ply_number % 2 === 1 : m.ply_number % 2 === 0;
    return isPlayer;
  });

  // 1. Accuracy Component (60%)
  let accuracyComponent = 60.0;
  if (playerMoves.length > 0) {
    const accuracies = playerMoves.map((m) => computeMoveAccuracy(m));
    const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
    accuracyComponent = Number((meanAccuracy * 0.6).toFixed(1));
  }

  // 2. Motif Component (30%)
  let motifComponent = 15.0; // default neutral
  const result = sessionSummary.result;
  if (result) {
    const won = (playerColor === 'white' && result === '1-0') || (playerColor === 'black' && result === '0-1');
    const lost = (playerColor === 'white' && result === '0-1') || (playerColor === 'black' && result === '1-0');
    const drawn = result === '1/2-1/2';

    if (won) motifComponent = 30.0;
    else if (drawn) motifComponent = 15.0;
    else if (lost) motifComponent = 0.0;
  } else if (moves.length > 0) {
    const lastMove = moves[moves.length - 1];
    const finalEval = lastMove.eval_cp_after ?? lastMove.eval_cp_before ?? 0;
    const isPlayerAhead = playerColor === 'white' ? finalEval > 50 : finalEval < -50;
    motifComponent = isPlayerAhead ? 25.0 : 10.0;
  }

  // 3. Hint Penalty (-10 pts per hint, capped at 30 pts)
  const hintCount = sessionSummary.hint_count || 0;
  const hintPenalty = Number(Math.min(30.0, hintCount * 10.0).toFixed(1));

  // Total Score (0 - 100)
  const rawTotal = accuracyComponent + motifComponent - hintPenalty;
  const totalScore = Number(Math.max(0, Math.min(100, rawTotal)).toFixed(1));

  // Letter Grade
  let grade = 'D';
  if (totalScore >= 95) grade = 'A+';
  else if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 70) grade = 'B';
  else if (totalScore >= 50) grade = 'C';

  return {
    accuracyComponent,
    motifComponent,
    hintPenalty,
    totalScore,
    grade,
  };
}

