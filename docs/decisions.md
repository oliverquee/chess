# Decision log

## 2026-08-15 — Motif-ready Lichess practice start

**Status:** approved

Lichess puzzle exports place the opponent/setup move at `Moves[0]` and provide
the raw FEN from immediately before that move. Starting targeted practice at
the raw FEN exposes the setup rather than the intended motif.

Targeted practice therefore applies `Moves[0]` legally to the raw exported FEN
and uses the resulting motif-ready FEN as the live Stockfish game start. The
remaining solution moves are retained only as reference evidence and are not
forced after startup.

This replaces the temporary raw-FEN behavior previously documented by PR #1.

## 2026-08-15 — Lite single-threaded Stockfish first

**Status:** approved

The first real engine integration uses a locally vendored lite, single-threaded
WASM build. SharedArrayBuffer and cross-origin isolation are deferred unless
measured performance later proves they are necessary.

## 2026-08-15 — AI backend and provenance contract

**Status:** approved

Claude API and local Ollama share one backend abstraction. Every persisted
classification records the backend, model, prompt version, analysis timestamp,
and, when practical, prompt hash so model/prompt changes are not misread as
player improvement.

## 2026-08-15 — Completed chess.com import only

**Status:** approved

Completed standard games may be imported post-hoc through the public archive
API or manually exported PGN and evaluated locally. Active-game board-state
extraction, Stockfish analysis, or AI assistance is forbidden; the live
chess.com surface remains theme-only.

## 2026-08-15 — P0 failure atomicity

**Status:** correctness clarification

P0 operations must not leave partial state after a dependency or input failure.
Puzzle corpus import runs in one database transaction, and a practice turn is
committed to in-memory session state only after its required move, analysis,
and engine-response work succeeds.

## 2026-08-15 — Durable M2 session lifecycle

**Status:** approved implementation of the handoff state machine

The required `queued → in_progress → completed → analyzed` lifecycle is stored
in `games.status` rather than existing only in renderer or process memory.
Starting a new target inserts two queued game rows and starts the first.
Completing the active game writes its moves and advances its status atomically;
analysis later performs the separate completed-to-analyzed transition.

## 2026-08-15 — M3 validated analysis boundary

**Status:** approved implementation of the handoff analysis contract

Each of the three analysis tasks has its own versioned prompt file and output
validator. The shared runner retries invalid model output exactly once with
validation feedback. Per-move attempts are persisted separately from immutable
game/move evidence: valid classifications create a fixed-taxonomy weakness tag;
double-invalid responses or backend failures create an `unclassified` attempt
without fabricating a tag. Prompt/model/backend provenance is stored for both
outcomes.
