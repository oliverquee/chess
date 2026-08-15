function nullableInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) throw new TypeError(`${fieldName} must be an integer or null.`);
  return value;
}

/**
 * Stockfish UCI scores are reported from the side-to-move perspective.
 * A legal chess move flips the side to move, so the post-move score must be
 * negated before it is compared with the pre-move score from the mover's
 * perspective.
 *
 * Positive result => the played move improved the mover's evaluation.
 * Negative result => the played move worsened the mover's evaluation.
 * Mate sentinel scores are deliberately not converted into centipawn deltas.
 */
export function computeEvalDelta(log) {
  if (!log || typeof log !== 'object') throw new TypeError('log must be an object.');

  const before = nullableInteger(log.eval_cp_before, 'log.eval_cp_before');
  const after = nullableInteger(log.eval_cp_after, 'log.eval_cp_after');

  if (before === null || after === null) return null;
  if (Boolean(log.is_mate_score)) return null;

  return -after - before;
}
