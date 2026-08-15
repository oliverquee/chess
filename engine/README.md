# Engine layer

`stockfishWorker.js` is a UCI client around a browser/Electron `Web Worker`. The default local worker asset path is:

```text
/engine/vendor/stockfish/stockfish.js
```

The repository vendors Stockfish.js 18.0.8's lite single-threaded
`stockfish.js` and matching `stockfish.wasm` beside it. No remote engine URL is
used. Provenance, checksums, and the GPL-3.0 license are in
`engine/vendor/stockfish/`.

The Electron build can call `configureStockfish({ workerUrl })` with the
packaged local asset URL. Headless Node scripts/tests use
`nodeWorkerAdapter.js`; game logic and UCI behavior are identical.

## Core API

```js
import { analyzePosition, playMove } from './stockfishWorker.js';

const analysis = await analyzePosition(fen, 16);
// { bestMove, evalCp, isMateScore, principalVariation }

const move = await playMove(fen, 10);      // Stockfish Skill Level 0–20
const eloMove = await playMove(fen, 1800); // UCI_LimitStrength + UCI_Elo
```

Searches are serialized so a new UCI search is never started while another is active. `analyzePosition()` resets the engine to unrestricted strength before analysis. Mate UCI scores retain the ±100000 sentinel for compatibility but are explicitly flagged with `isMateScore`; downstream code must not treat that sentinel as an ordinary centipawn value.

## Practice-session logging

`practiceSession.js` legally applies the seed puzzle's `Moves[0]` setup move to
the raw exported `FEN` and starts from the resulting motif-ready position. The
remaining puzzle solution line is never enforced. Every logged move retains the
information required by the future analysis prompt:

- `fen_before`
- `move_played`
- `eval_cp_before`
- `eval_cp_after`
- `best_move`
- `principal_variation`
- `is_mate_score`
- `stockfish_response`
- `timestamp`

Stockfish UCI evaluations are relative to the side to move. Because the side changes after every legal move, do **not** subtract the raw consecutive scores directly. `eval.js` provides `computeEvalDelta(log)`, which negates the post-move score before comparison so the result stays in the mover's perspective. It returns `null` when a mate sentinel is involved.

`fen.js` delegates legal UCI move application and FEN state updates to `chess.js` rather than reimplementing chess rules. This covers castling, promotion, en passant, legality checks, clocks, and castling-right updates.

`chess.js` emits its canonical FEN form, so an en-passant target square is present only when a legal en-passant capture is available.

## Tests

From the repository root:

```bash
npm install
npm test
```

The regression suite includes both fast fake-worker protocol tests and a real
Stockfish WASM → practice session → SQLite close/reopen golden-path test.
