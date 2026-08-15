# Storage layer

Local persistence for the single-user Chess Analyst Electron app. This module has no server, cloud sync, network calls, or AI/LLM behavior.

## SQLite runtime

This layer uses Node's built-in `node:sqlite` `DatabaseSync` API for synchronous local access. The repository targets Node `>=22.13.0`, where `node:sqlite` is available without the earlier startup flag.

Why `node:sqlite`:

- synchronous API matches this small local single-user workload;
- no extra runtime dependency;
- avoids another native-addon rebuild step when Electron is packaged;
- all access is isolated behind `/storage`, so the implementation can be swapped later if needed.

The Electron runtime selected later must embed Node 22.13+.

## Training-history schema

`schema.sql` creates the three personal-history tables defined by `SPEC.md`:

- `games` — one row per practice/imported game;
- `moves` — ordered move records belonging to a game;
- `weakness_tags` — future structured AI-classification tags attached to individual moves.

`moves` stores analysis-ready engine context rather than the old ambiguous single evaluation:

- `eval_cp_before`
- `eval_cp_after`
- `best_move`
- `principal_variation`
- `is_mate_score`

`initDb()` also performs the cheap legacy migration needed for databases created before these columns existed. If a legacy `eval_cp` column is present, its value is copied to `eval_cp_before`. `eval_cp_after` remains `NULL` because inventing a post-move evaluation would corrupt historical data; old sessions must be re-analyzed if that value is required.

Foreign-key enforcement is enabled on every connection. Indexes exist for `games(seeded_weakness)`, `moves(game_id)`, and `weakness_tags(category)`.

The large, rebuildable Lichess puzzle corpus is intentionally handled by `/data/puzzleDb.js` rather than being mixed conceptually with irreplaceable training history/backups.

`PracticeSession.summary()` does not contain a separate game date. `saveGameSession()` stores the first move timestamp as `games.date`; for a zero-move session it uses the save time.

## API

```js
import {
  initDb,
  saveGameSession,
  getGameHistory,
  saveWeaknessTags,
  getWeaknessTally,
} from './db.js';

const db = initDb('/path/to/chess-analyst.sqlite');
saveGameSession(db, practiceSession.summary());

const history = getGameHistory(db, { limit: 20, weaknessCategory: 'tactical' });
```

`saveGameSession()` inserts the game and all moves inside one `BEGIN IMMEDIATE` transaction. Any move validation or SQLite failure rolls back the complete session insert.

`saveWeaknessTags()` is the storage boundary intended for the future `/analysis` per-move classification step. It accepts one tag object or an array and defaults `source` to `ai_classification`; it does not perform analysis itself.

`getWeaknessTally({ sinceGameId })` includes the anchor game and games chronologically after it, grouping stored tags by the fixed weakness category. Without `sinceGameId`, it tallies all stored tags.

## Tests

From the repository root with Node 22.13+:

```bash
npm install
npm test
```

`test/storage.test.js` constructs real `PracticeSession.summary()` objects so storage tests detect engine/storage shape drift. It also verifies the legacy `eval_cp` migration does not fabricate missing post-move analysis.
