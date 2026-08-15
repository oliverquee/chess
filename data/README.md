# Data layer

The production Lichess puzzle corpus is SQLite-backed. The full database must **not** be parsed into renderer memory as JavaScript objects.

- `puzzleDb.js` — opens/queries the indexed local puzzle database.
- `puzzleSchema.sql` — rebuildable puzzle-corpus schema.
- `puzzleLoader.js` — small in-memory implementation retained for unit tests and deliberately curated subsets only.
- `themeMapping.js` — fixed Lichess-theme → weakness mapping and start-slow selection rules.

## Import the Lichess corpus

Download the CC0 Lichess puzzle export separately and decompress it to CSV. The repository does not commit the multi-gigabyte source/export or the generated SQLite file.

```bash
npm run import:puzzles -- /path/to/lichess_db_puzzle.csv /path/to/puzzles.sqlite
```

The importer streams rows in batches into:

- `puzzles` — FEN, UCI moves, rating, ply count
- `puzzle_themes` — normalized theme rows

Indexes support theme and ply-count queries without building multi-million-entry JS `Map`/`Set` structures.

## Production query example

```js
import { openPuzzleDb, SqlitePuzzleLibrary } from './puzzleDb.js';
import { setPuzzleLibrary } from './puzzleLoader.js';
import { getPuzzlesForWeakness } from './themeMapping.js';

const db = openPuzzleDb('/path/to/puzzles.sqlite');
setPuzzleLibrary(new SqlitePuzzleLibrary(db));

const startSlowQueue = getPuzzlesForWeakness('tactical');
// Exactly two selections: short (2–6 ply) + long (8–12 ply), with a
// longest-available fallback marked bucketDowngraded=true when needed.
```

`themeTags` use OR semantics. Ply count is always `Moves.trim().split(/\s+/).length`; it is never divided by two.

The theme-to-weakness table is fixed to the seven categories in `SPEC.md`. Origin tags (`master`, `masterVsMaster`, `superGM`, `mix`) and puzzle-length tags (`oneMove`, `short`, `long`, `veryLong`) are metadata, not weaknesses. Forced-mate and named mate-pattern themes map to `tactical`.

Lichess has no genuine motif tag mapped to `practical_time`. Seed selection therefore fails explicitly for that category; `/core` must skip to the next seedable weakness and surface practical-time as advice instead.

## Tests

From the repository root:

```bash
npm install
npm test
```
