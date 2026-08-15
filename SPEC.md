# Chess Analyst App — Project Spec (source of truth)
Personal-use only. Any contributor/tool reading this repo must follow these
decisions exactly — do not reintroduce cut scope or invent alternatives.

## Platform
Electron desktop app (not a website for v1).

## Chess.com integration
Embedded webview, THEME-ONLY overlay (CSS/JS injection for visual skin).
No functional changes. No AI analysis, no assistance, no live data reading
during any chess.com gameplay. This is a hard rule — fair-play/ToS risk.

## Stockfish practice mode
- stockfish.js (WASM), runs client-side in a Web Worker.
- User plays live games against Stockfish.
- "Future moves" preview is available ONLY in this mode (no human opponent).
- Games logged move-by-move: FEN, move played, engine eval.

## AI analysis (separate, manual, NOT live)
Standalone page. User pastes in game history (from Stockfish practice or
chess.com archived/exported games). Never connected live to any gameplay.
Backend is user's choice: Claude API (their own key, paid) or local Ollama
(free). Three structured prompts (see /prompts/ai-analysis.md):
1. Per-move classification — structured JSON output, fixed taxonomy below.
2. Checklist aggregation — ranks weaknesses, selects seed puzzles from
   existing library (does NOT invent new positions).
3. Progress review — before/after trend per weakness category.

## Fixed weakness taxonomy (do not deviate — needed for trend tracking)
tactical | king_safety | pawn_structure | piece_activity |
positional_judgment | endgame_technique | practical_time

## Seed puzzle library
Source: Lichess open puzzle DB (CC0 license, database.lichess.org).
Fields used: FEN, Moves (UCI sequence), Themes, Rating.
- Step count = len(Moves) in ply. Bucket: short (~5-6 ply), long (~8-10 ply).
- Requires a lookup table mapping Lichess Themes -> the taxonomy above.
- "Start slow" rule: a newly targeted weakness gets exactly 2 seed puzzles
  queued (1 short + 1 long), not a batch.
- Puzzle FEN is used as a LIVE GAME START POSITION vs Stockfish — this is
  NOT a forced-solution puzzle solve. Play continues normally with
  future-moves preview active until the session ends.

## Storage
Local SQLite. Tables: games, moves, weakness_tags. All local, no backend
server — single user, personal use.

## Theming
Swappable animal-themed asset packs (cat, panda, others TBD): pieces,
board, palette, UI chrome. Applies to both native app UI and the chess.com
overlay. Fully decoupled from logic layers — build/change independently.

## Explicitly OUT of scope for v1 (do not build without updating this file)
- Live AI analysis during any gameplay, anywhere.
- Pet-care/gamification tracker (parked — see /docs/deferred.md if
  revisited).
- Reels/reward content layer (parked).
- Dynamic/live weakness-motif injection by Stockfish mid-game (seed
  positions only, not engine-generated traps).

## Repo structure
```
/app          (Electron shell, chess.com webview, theme layer)
/engine       (Stockfish worker integration, seed-puzzle filtering)
/analysis     (AI analysis page, prompt templates, backend switch)
/storage      (SQLite schema, queries)
/data         (Lichess puzzle DB subset, theme-mapping lookup table)
/prompts      (AI prompt text, versioned as files, not buried in code)
/docs         (deferred.md, decisions log)
SPEC.md
README.md
```
