# Storage layer

Local persistence for the single-user Chess Analyst Electron app. This module has no server, cloud sync, network calls, or AI/LLM behavior.

## SQLite runtime

This layer uses Node's built-in `node:sqlite` `DatabaseSync` API for synchronous local access. The repository now targets Node `>=22.13.0`, where `node:sqlite` is available without the earlier `--experimental-sqlite` startup flag.

Why `node:sqlite` instead of `better-sqlite3`:

- it provides the required synchronous SQLite API without another runtime dependency;
- it avoids a native addon/rebuild step when the Electron package is assembled;
- the storage workload is local and small, so a synchronous connection is appropriate.

The Electron runtime selected later must therefore embed Node 22.13+.

## Schema

`schema.sql` creates the three tables defined by `SPEC.md`:

- `games` — one row per practice/imported game;
- `moves` — ordered move records belonging to a game;
- `weakness_tags` — future structured AI-classification tags attached to individual moves.

Foreign-key enforcement is enabled on every connection. Indexes are created for `games(seeded_weakness)`, `moves(game_id)`, and `weakness_tags(category)`.

`PracticeSession.summary()` does not currently contain a separate game date. `saveGameSession()` therefore stores the first move timestamp as `games.date`; for a zero-move session it uses the save time.

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

`saveWeaknessTags()` is the storage boundary intended for the future `/analysis` per-move classification step. It accepts one tag object or an array of tag objects and defaults `source` to `ai_classification`; it does not perform analysis itself.

`getWeaknessTally({ sinceGameId })` includes the anchor game and games chronologically after it, grouping stored tags by the fixed weakness category. Without `sinceGameId`, it tallies all stored tags.

## Tests

From the repository root with Node 22.13+:

```bash
npm test
```

`test/storage.test.js` uses temporary local SQLite files and constructs real `PracticeSession.summary()` objects from the existing engine module so storage tests detect engine/storage shape drift.
