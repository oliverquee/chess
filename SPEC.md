# Chess Analyst App — Project Spec (source of truth)
Personal-use only. Any contributor/tool reading this repo must follow these
decisions exactly — do not reintroduce cut scope or invent alternatives.

## Platform
Electron desktop app (not a website for v1).

## Chess.com integration
Embedded external-content surface, THEME-ONLY overlay (CSS/JS visual skin).
No functional changes. No AI analysis, no assistance, no live data reading
during any chess.com gameplay. This is a hard rule — fair-play/ToS risk.

## Stockfish practice mode
- stockfish.js (WASM), runs client-side in a Web Worker.
- User plays live games against Stockfish.
- "Future moves" preview is available ONLY in this mode (no human opponent).
- Games are logged move-by-move with the FEN before the move, move played,
  engine evaluation before and after the move, engine best move, principal
  variation, mate-score flag, Stockfish response, and timestamp.
- Evaluation deltas used by analysis MUST be normalized to the perspective of
  the side that made the move. Raw consecutive Stockfish scores must never be
  subtracted directly because UCI scores are relative to the side to move.

## AI analysis (separate, manual, NOT live)
Standalone page. User pastes in game history (from Stockfish practice or
chess.com archived/exported games). Never connected live to any gameplay.
Backend is user's choice: Claude API (their own key, paid) or local Ollama
(free). Three structured prompts (see /prompts/ai-analysis.md):
1. Per-move classification — input includes FEN before the move, move played,
   engine best move, normalized eval delta, and game phase. Structured JSON
   output only, using the fixed taxonomy below.
2. Checklist aggregation — ranks weaknesses and selects seed puzzles from the
   existing library. It must never invent new positions or opening theory.
3. Progress review — before/after trend per weakness category.

## Fixed weakness taxonomy (do not deviate — needed for trend tracking)
tactical | king_safety | pawn_structure | piece_activity |
positional_judgment | endgame_technique | practical_time

`practical_time` is a valid tracked weakness but is not a seed-puzzle motif.
If it ranks highest, orchestration must surface it as advice and continue to the
next seedable weakness rather than attempting to invent a puzzle mapping.

## Seed puzzle library
Source: Lichess open puzzle DB (CC0 license, database.lichess.org).
Fields used: PuzzleId, FEN, Moves (UCI sequence), Themes, Rating.
- The production dataset is pre-processed once into a local SQLite puzzle DB;
  the full Lichess CSV must not be loaded into renderer memory as JS objects.
- Step count = `Moves.split(' ').length` in ply. Do not divide by two.
- Buckets: short = 2–6 ply; long = 8–12 ply.
- If no long puzzle exists for a seedable weakness, use the longest available
  matching puzzle and mark it `bucketDowngraded: true`.
- Requires a lookup table mapping Lichess Themes -> the taxonomy above.
- "Start slow" rule: a newly targeted seedable weakness gets exactly 2 seed
  puzzles queued (1 short + 1 long/fallback), not a batch.
- Puzzle FEN is used as a LIVE GAME START POSITION vs Stockfish — this is NOT a
  forced-solution puzzle solve. Play continues normally with future-moves
  preview active until the session ends.
- Note: Lichess documents its exported FEN as the position before the opponent's
  setup move. v1 intentionally keeps the raw FEN-as-start behavior above; do
  not silently apply the first puzzle move unless this spec is changed.

## Storage
Local SQLite, no backend server, no cloud sync. Personal training history uses:
- `games`
- `moves`
- `weakness_tags`

The `moves` record stores `eval_cp_before`, `eval_cp_after`, `best_move`,
`principal_variation`, and `is_mate_score` in addition to move/FEN/timestamp
fields. Existing pre-fix databases may retain legacy `eval_cp` during migration,
but new writes use the explicit before/after fields.

The Lichess puzzle corpus is also stored locally in SQLite as pre-processed
puzzle data with theme and ply-count indexes. It is rebuildable source data and
should be treated separately from irreplaceable user training history when
backing up files.

## Core orchestration
`/core` owns training-loop rules independent of UI: seed selection, start-slow
queueing, practical_time fallback, session lifecycle, persistence handoff, and
next-focus selection. UI layers must not become the owner of these rules.

## Theming
Swappable animal-themed asset packs (cat, panda, others TBD): pieces,
board, palette, UI chrome. Applies to both native app UI and the chess.com
overlay. Fully decoupled from logic layers — build/change independently.

## Explicitly OUT of scope for v1 (do not build without updating this file)
- Live AI analysis or assistance during any gameplay, anywhere.
- Pet-care/gamification tracker (parked — see /docs/deferred.md if revisited).
- Reels/reward content layer (parked).
- Dynamic/live weakness-motif injection by Stockfish mid-game (seed positions
  only, not engine-generated traps).
- External users, accounts, multiplayer product features, or public SaaS scope.

## Repo structure
```
/app          Electron shell, chess.com theme-only surface, theme layer
/core         UI-independent training-loop orchestration
/engine       Stockfish worker integration, practice-session logic
/analysis     Manual/offline AI analysis page and backend switch
/storage      SQLite schema and training-history queries
/data         Lichess puzzle DB access and theme-mapping lookup table
/scripts      One-time local data import/pre-processing utilities
/prompts      Versioned AI prompt text
/docs         Deferred features and decision log
SPEC.md
README.md
```
