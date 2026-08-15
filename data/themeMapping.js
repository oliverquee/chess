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
  short: Object.freeze([5, 6]),
  long: Object.freeze([8, 10]),
});

export const THEME_TO_WEAKNESS = Object.freeze({
  advancedPawn: 'pawn_structure',
  advantage: 'positional_judgment',
  anastasiaMate: 'king_safety',
  arabianMate: 'king_safety',
  attackingF2F7: 'king_safety',
  attraction: 'tactical',
  backRankMate: 'king_safety',
  balestraMate: 'king_safety',
  bishopEndgame: 'endgame_technique',
  blindSwineMate: 'king_safety',
  bodenMate: 'king_safety',
  capturingDefender: 'tactical',
  castling: 'king_safety',
  checkFirst: 'tactical',
  clearance: 'piece_activity',
  collinearMove: 'piece_activity',
  cornerMate: 'king_safety',
  crushing: 'positional_judgment',
  defensiveMove: 'positional_judgment',
  deflection: 'tactical',
  discoveredAttack: 'tactical',
  discoveredCheck: 'tactical',
  doubleBishopMate: 'king_safety',
  doubleCheck: 'king_safety',
  dovetailMate: 'king_safety',
  endgame: 'endgame_technique',
  enPassant: 'pawn_structure',
  epauletteMate: 'king_safety',
  equality: 'positional_judgment',
  exposedKing: 'king_safety',
  fork: 'tactical',
  hangingPiece: 'tactical',
  hookMate: 'king_safety',
  interference: 'tactical',
  intermezzo: 'tactical',
  killBoxMate: 'king_safety',
  kingsideAttack: 'king_safety',
  knightEndgame: 'endgame_technique',
  long: 'practical_time',
  mate: 'king_safety',
  mateIn1: 'king_safety',
  mateIn2: 'king_safety',
  mateIn3: 'king_safety',
  mateIn4: 'king_safety',
  mateIn5: 'king_safety',
  middlegame: 'positional_judgment',
  oneMove: 'practical_time',
  operaMate: 'king_safety',
  opening: 'positional_judgment',
  pawnEndgame: 'endgame_technique',
  pillsburysMate: 'king_safety',
  pin: 'tactical',
  promotion: 'pawn_structure',
  queenEndgame: 'endgame_technique',
  queenRookEndgame: 'endgame_technique',
  queensideAttack: 'king_safety',
  quietMove: 'positional_judgment',
  rookEndgame: 'endgame_technique',
  sacrifice: 'tactical',
  short: 'practical_time',
  skewer: 'tactical',
  smotheredMate: 'king_safety',
  swallowstailMate: 'king_safety',
  trappedPiece: 'piece_activity',
  triangleMate: 'king_safety',
  underPromotion: 'pawn_structure',
  veryLong: 'practical_time',
  vukovicMate: 'king_safety',
  xRayAttack: 'piece_activity',
  zugzwang: 'endgame_technique',
});

export const NON_WEAKNESS_METADATA_THEMES = Object.freeze([
  'master',
  'masterVsMaster',
  'superGM',
  'mix',
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

function getOneForBucket(weaknessCategory, bucket, library, random) {
  const stepRange = STEP_BUCKETS[bucket];
  if (!stepRange) throw new RangeError(`Unknown step bucket: ${bucket}`);

  const candidates = filterPuzzles(
    {
      themeTags: getThemeTagsForWeakness(weaknessCategory),
      stepRange,
    },
    library,
  );

  const puzzle = pickOne(candidates, random);
  if (!puzzle) {
    throw new Error(`No ${bucket} puzzle available for weakness ${weaknessCategory}.`);
  }
  return puzzle;
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
