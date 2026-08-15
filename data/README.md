# Data layer

`puzzleLoader.js` parses a local Lichess puzzle CSV into a `PuzzleLibrary` with theme and ply-count indexes. It does not perform network access.

## Core API

```js
import { loadPuzzleCsv, filterPuzzles } from './puzzleLoader.js';
import { getPuzzlesForWeakness } from './themeMapping.js';

loadPuzzleCsv(csvText);

const tactical = filterPuzzles({
  themeTags: ['fork', 'pin'],
  stepRange: [5, 6],
});

const startSlowQueue = getPuzzlesForWeakness('tactical');
// Exactly two puzzles: one 5-6 ply and one 8-10 ply.
```

`themeTags` uses OR semantics: a puzzle matching any requested theme is eligible. Ply count is always `Moves.trim().split(/\s+/).length`; it is never divided by two.

The Lichess theme-to-weakness table is intentionally fixed to the seven categories in `SPEC.md`. Origin-only tags (`master`, `masterVsMaster`, `superGM`, `mix`) are metadata and are not treated as weaknesses.

## Tests

From the repository root:

```bash
npm test
```
