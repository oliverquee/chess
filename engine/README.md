# Engine layer

`stockfishWorker.js` is a UCI client around a browser/Electron `Web Worker`. The default local worker asset path is:

```text
/engine/vendor/stockfish/stockfish.js
```

Keep the matching `.wasm` file(s) beside that script. No remote engine URL is used. The Electron build can instead call `configureStockfish({ workerUrl })` with the packaged local asset URL.

## Core API

```js
import { analyzePosition, playMove } from './stockfishWorker.js';

const analysis = await analyzePosition(fen, 16);
// { bestMove, evalCp, principalVariation }

const move = await playMove(fen, 10);   // Stockfish Skill Level 0-20
const eloMove = await playMove(fen, 1800); // UCI_LimitStrength + UCI_Elo
```

Searches are serialized so a new UCI search is never started while another is active. `analyzePosition()` resets the engine to unrestricted strength before analysis.

`practiceSession.js` starts exactly from the seed puzzle's `FEN`; the puzzle solution line is never enforced. `fen.js` applies UCI moves and updates FEN state (including castling, promotion, and en passant) without adding any AI behavior.

## Tests

From the repository root:

```bash
npm test
```

Tests inject a fake worker/engine, so a Stockfish WASM binary is not required just to verify the engine/data logic.
