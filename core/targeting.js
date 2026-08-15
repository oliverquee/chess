import { getPuzzlesForWeakness, WEAKNESS_CATEGORIES } from '../data/themeMapping.js';

export const PRACTICAL_TIME_ADVICE = 'Practical/time is not a puzzle motif. Slow down and use a deliberate pre-move scan before committing.';

function categoryOf(entry) {
  return typeof entry === 'string' ? entry : entry?.category;
}

/**
 * Converts Prompt-2-style ranked weaknesses into the next seedable practice
 * target. practical_time stays visible as advice but cannot manufacture a
 * Lichess motif, so selection continues to the next ranked category.
 */
export function selectSeedableTarget(
  rankedWeaknesses,
  { getPuzzles = getPuzzlesForWeakness } = {},
) {
  if (!Array.isArray(rankedWeaknesses)) throw new TypeError('rankedWeaknesses must be an array.');

  const skipped = [];
  for (const entry of rankedWeaknesses) {
    const category = categoryOf(entry);
    if (!WEAKNESS_CATEGORIES.includes(category)) {
      throw new RangeError(`Unknown weakness category: ${category}`);
    }

    if (category === 'practical_time') {
      skipped.push({
        category,
        reason: 'non_seedable',
        advice: PRACTICAL_TIME_ADVICE,
      });
      continue;
    }

    return {
      weaknessCategory: category,
      puzzles: getPuzzles(category, 'start-slow'),
      skipped,
    };
  }

  return {
    weaknessCategory: null,
    puzzles: [],
    skipped,
  };
}
