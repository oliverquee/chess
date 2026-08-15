import { filterPuzzles, getPuzzleLibrary } from './puzzleLoader.js';

export const WEAKNESS_CATEGORIES = Object.freeze([
  'tactical',
  'king_safety',
  'pawn_structure',
  'piece_activity',
  'positional_judgment',
  'endgame_technique',
  'practical_time',
]);

export const STEP_BUCKETS = Object.freeze({
  short: Object.freeze([2, 6]),
  long: Object.freeze([8, 12]),
});

export const THEME_TO_WEAKNESS = Object.freeze({
  advancedPawn: 'pawn_structure',
  advantage: 'positional_judgment',
  anastasiaMate: 'tactical',
  arabianMate: 'tactical',
  attackingF2F7: 'king_safety',
  attraction: 'tactical',
  backRankMate: 'tactical',
  balestraMate: 'tactical',
  bishopEndgame: 'endgame_technique',
  blindSwineMate: 'tactical',
  bodenMate: 'tactical',
  capturingDefender: 'tactical',
  castling: 'king_safety',
  checkFirst: 'tactical',
  clearance: 'piece_activity',
  collinearMove: 'piece_activity',
  cornerMate: 'tactical',
  crushing: 'positional_judgment',
  defensiveMove: 'positional_judgment',
  deflection: 'tactical',
  discoveredAttack: 'tactical',
  discoveredCheck: 'tactical',
  doubleBishopMate: 'tactical',
  doubleCheck: 'king_safety',
  dovetailMate: 'tactical',
  endgame: 'endgame_technique',
  enPassant: 'pawn_structure',
  epauletteMate: 'tactical',
  equality: 'positional_judgment',
  exposedKing: 'king_safety',
  fork: 'tactical',
  hangingPiece: 'tactical',
  hookMate: 'tactical',
  interference: 'tactical',
  intermezzo: 'tactical',
  killBoxMate: 'tactical',
  kingsideAttack: 'king_safety',
  knightEndgame: 'endgame_technique',
  mate: 'tactical',
  mateIn1: 'tactical',
  mateIn2: 'tactical',
  mateIn3: 'tactical',
  mateIn4: 'tactical',
  mateIn5: 'tactical',
  middlegame: 'positional_judgment',
  operaMate: 'tactical',
  opening: 'positional_judgment',
  pawnEndgame: 'endgame_technique',
  pillsburysMate: 'tactical',
  pin: 'tactical',
  promotion: 'pawn_structure',
  queenEndgame: 'endgame_technique',
  queenRookEndgame: 'endgame_technique',
  queensideAttack: 'king_safety',
  quietMove: 'positional_judgment',
  rookEndgame: 'endgame_technique',
  sacrifice: 'tactical',
  skewer: 'tactical',
  smotheredMate: 'tactical',
  swallowstailMate: 'tactical',
  trappedPiece: 'piece_activity',
  triangleMate: 'tactical',
  underPromotion: 'pawn_structure',
  vukovicMate: 'tactical',
  xRayAttack: 'piece_activity',
  zugzwang: 'endgame_technique',
});

export const NON_WEAKNESS_METADATA_THEMES = Object.freeze([
  'master',
  'masterVsMaster',
  'superGM',
  'mix',
  'oneMove',
  'short',
  'long',
  'veryLong',
]);

const WEAKNESS_TO_THEMES = Object.freeze(
  WEAKNESS_CATEGORIES.reduce((acc, category) => {
    acc[category] = Object.freeze(
      Object.entries(THEME_TO_WEAKNESS)
        .filter(([, mappedCategory]) => mappedCategory === category)
        .map(([theme]) => theme),
    );
    return acc;
  }, {}),
);

export function resolveThemeToWeakness(themeTag) {
  return THEME_TO_WEAKNESS[themeTag] ?? null;
}

export function getThemeTagsForWeakness(weaknessCategory) {
  if (!WEAKNESS_CATEGORIES.includes(weaknessCategory)) {
    throw new RangeError(`Unknown weakness category: ${weaknessCategory}`);
  }
  return WEAKNESS_TO_THEMES[weaknessCategory];
}

function pickOne(puzzles, random) {
  if (!puzzles.length) return null;
  const index = Math.min(puzzles.length - 1, Math.floor(random() * puzzles.length));
  return puzzles[index];
}

function sampleForQuery(library, query, random) {
  if (typeof library?.sample === 'function') return library.sample(query, random);
  return pickOne(filterPuzzles(query, library), random);
}

function longestForThemes(library, themeTags) {
  if (typeof library?.findLongest === 'function') return library.findLongest({ themeTags });

  return filterPuzzles(
    { themeTags, stepRange: [0, Number.POSITIVE_INFINITY] },
    library,
  ).reduce((longest, puzzle) => {
    if (!longest || puzzle.stepCount > longest.stepCount) return puzzle;
    return longest;
  }, null);
}

function getOneForBucket(weaknessCategory, bucket, library, random) {
  const stepRange = STEP_BUCKETS[bucket];
  if (!stepRange) throw new RangeError(`Unknown step bucket: ${bucket}`);

  const themeTags = getThemeTagsForWeakness(weaknessCategory);
  if (themeTags.length === 0) {
    throw new Error(`No seed-puzzle themes are mapped for weakness ${weaknessCategory}.`);
  }

  const puzzle = sampleForQuery(library, { themeTags, stepRange }, random);
  if (puzzle) return puzzle;

  if (bucket === 'long') {
    const fallback = longestForThemes(library, themeTags);
    if (fallback) {
      return Object.freeze({
        ...fallback,
        bucketDowngraded: true,
      });
    }
  }

  throw new Error(`No ${bucket} puzzle available for weakness ${weaknessCategory}.`);
}

export function getPuzzlesForWeakness(
  weaknessCategory,
  stepBucket = 'start-slow',
  { library = getPuzzleLibrary(), random = Math.random } = {},
) {
  if (!WEAKNESS_CATEGORIES.includes(weaknessCategory)) {
    throw new RangeError(`Unknown weakness category: ${weaknessCategory}`);
  }

  if (stepBucket === 'short' || stepBucket === 'long') {
    return [getOneForBucket(weaknessCategory, stepBucket, library, random)];
  }

  if (stepBucket !== 'start-slow' && stepBucket !== null && stepBucket !== undefined) {
    throw new RangeError(`Unknown step bucket: ${stepBucket}`);
  }

  return [
    getOneForBucket(weaknessCategory, 'short', library, random),
    getOneForBucket(weaknessCategory, 'long', library, random),
  ];
}
