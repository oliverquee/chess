import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePuzzleCsv } from '../data/puzzleLoader.js';
import {
  getPuzzlesForWeakness,
  resolveThemeToWeakness,
  WEAKNESS_CATEGORIES,
} from '../data/themeMapping.js';

const FEN = '8/8/8/8/8/8/4k3/4K3 w - - 0 1';
const CSV = `PuzzleId,FEN,Moves,Rating,Themes
t1,${FEN},e1d1 e2d2 d1c1 d2c2 c1b1,1200,fork short
t2,${FEN},e1d1 e2d2 d1c1 d2c2 c1b1 c2b2 b1a1 b2a2,1300,pin long
`;

test('theme mapping resolves only fixed taxonomy values', () => {
  assert.equal(resolveThemeToWeakness('fork'), 'tactical');
  assert.equal(resolveThemeToWeakness('exposedKing'), 'king_safety');
  assert.equal(resolveThemeToWeakness('pawnEndgame'), 'endgame_technique');
  assert.equal(resolveThemeToWeakness('master'), null);

  for (const theme of ['fork', 'exposedKing', 'advancedPawn', 'trappedPiece', 'quietMove', 'rookEndgame', 'short']) {
    assert.ok(WEAKNESS_CATEGORIES.includes(resolveThemeToWeakness(theme)));
  }
});

test('start-slow queue returns exactly one short and one long puzzle', () => {
  const library = parsePuzzleCsv(CSV);
  const puzzles = getPuzzlesForWeakness('tactical', 'start-slow', { library, random: () => 0 });
  assert.equal(puzzles.length, 2);
  assert.ok(puzzles[0].stepCount >= 5 && puzzles[0].stepCount <= 6);
  assert.ok(puzzles[1].stepCount >= 8 && puzzles[1].stepCount <= 10);
});
