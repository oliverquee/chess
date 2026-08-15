import test from 'node:test';
import assert from 'node:assert/strict';
import { countPuzzlePlies, parsePuzzleCsv } from '../data/puzzleLoader.js';

const CSV = `PuzzleId,FEN,Moves,Rating,Themes
short1,8/8/8/8/8/8/4k3/4K3 w - - 0 1,e1d1 e2d2 d1c1 d2c2 c1b1,1200,fork short
short2,8/8/8/8/8/8/4k3/4K3 w - - 0 1,e1d1 e2d2 d1c1 d2c2 c1b1 c2b2,1300,pin short
long1,8/8/8/8/8/8/4k3/4K3 w - - 0 1,e1d1 e2d2 d1c1 d2c2 c1b1 c2b2 b1a1 b2a2,1400,fork long
`;

test('step count is measured in ply, not move pairs', () => {
  assert.equal(countPuzzlePlies('a2a4 a7a5 b2b4 b7b5 c2c4'), 5);
  assert.equal(countPuzzlePlies(' a2a4   a7a5 b2b4 b7b5 c2c4 c7c5 '), 6);
});

test('PuzzleLibrary filters short and long ranges by exact ply count', () => {
  const library = parsePuzzleCsv(CSV);
  assert.deepEqual(library.filter({ themeTags: ['fork'], stepRange: [5, 6] }).map((p) => p.PuzzleId), ['short1']);
  assert.deepEqual(library.filter({ themeTags: ['fork'], stepRange: [8, 10] }).map((p) => p.PuzzleId), ['long1']);
});
