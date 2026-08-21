const SIGMOID_COEFFICIENT = -0.00368208;
const MATE_SCORE_THRESHOLD = 90000;

/**
 * Converts a centipawn evaluation into a White win probability percentage (0 - 100)
 * using the official Lichess winning probability sigmoid function.
 */
export function evalToWinPercent(evalCp, isMate = false) {
  if (evalCp === null || evalCp === undefined || !Number.isFinite(evalCp)) {
    return 50;
  }

  if (isMate || Math.abs(evalCp) >= MATE_SCORE_THRESHOLD) {
    return evalCp > 0 ? 100 : 0;
  }

  const sigmoid = 2 / (1 + Math.exp(SIGMOID_COEFFICIENT * evalCp)) - 1;
  const percent = 50 + 50 * sigmoid;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(1));
}

/**
 * Formats evaluation into human-readable label (+1.5, -0.4, 0.0, +M, -M).
 */
export function formatEvalLabel(evalCp, isMate = false) {
  if (evalCp === null || evalCp === undefined || !Number.isFinite(evalCp)) {
    return '0.0';
  }

  if (isMate || Math.abs(evalCp) >= MATE_SCORE_THRESHOLD) {
    return evalCp > 0 ? '+M' : '-M';
  }

  const pawns = (evalCp / 100).toFixed(1);
  if (evalCp > 0) return `+${pawns}`;
  if (evalCp === 0) return '0.0';
  return pawns;
}

/**
 * Computes full eval bar display state.
 */
export function computeEvalBarState(analysis = {}) {
  const evalCp = analysis?.evalCp ?? 0;
  const isMate = Boolean(analysis?.isMateScore);

  const whiteWinPercent = evalToWinPercent(evalCp, isMate);
  const blackWinPercent = Number((100 - whiteWinPercent).toFixed(1));
  const label = formatEvalLabel(evalCp, isMate);

  return {
    evalCp,
    isMate,
    whiteWinPercent,
    blackWinPercent,
    label,
    // CSS height for White's portion of the vertical bar
    whiteHeightPercent: whiteWinPercent,
  };
}

