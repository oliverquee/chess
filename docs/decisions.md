# Decision log

## 2026-08-21 — M10 assistance rule amendment and usage-based tracking

**Status:** approved

Amended the invariant on AI analysis and assistance to cleanly distinguish between
the two runtime surfaces:
1. Chess.com embedded surface: Strictly zero assistance, evaluation, or DOM extraction
   (theme-only CSS injection). Non-negotiable fair-play and ToS boundary.
2. Offline Practice & Free Play vs local Stockfish: On-demand assistance (SEE hanging
   piece detection, null-move threats, blunder confirmations, best-move nudges, future
   move preview, and eval bar) is permitted as a core learning/training mechanism.

To protect longitudinal analytical data integrity:
- Every game persists `assistance_level` (`'none'`, `'preview'`, `'hints'`, `'full'`),
  `hint_count`, and `takeback_count`, derived from actual in-game actions rather than
  pre-configured settings.
- All weakness, bias, and CPL metrics queries strictly filter `WHERE assistance_level = 'none'`.

## 2026-08-20 — M9 addendum: embedded Chess.com theme-only surface

**Status:** implemented; emulator selector verification pending

The Chess.com tab uses `@capgo/capacitor-inappbrowser` 8.x because this
checkout is on Capacitor 8 and the plugin supplies a native embedded WebView,
`executeScript`, page-load and URL-change events, and persistent website data.
It does not use `@capacitor/browser` or a Custom Tab. The orange-cat CSS is
bundled as text, injected before the first display, and re-injected
idempotently after full-page and SPA navigation. The WebView is hidden rather
than destroyed from its toolbar so the same browser context and login can be
reused; `persistWebViewData` is also explicitly enabled.

The injected code may only create a `<style>` element, assign the bundled CSS,
and append it to `document.head`. The app does not register page-to-host
messaging, request cookies, capture page screenshots, or return DOM content.
No board reading, position scraping, evaluation, or assistance is connected to
this view. Completed-game import remains a separate post-hoc workflow.

The existing selectors (`wc-chess-board`, `chess-board`, `.board`, square
light/dark variants, highlights, and current Chess.com button classes) remain
desktop-derived until the emulator opens the real mobile page. Actual observed
coverage and any selector adjustments will be recorded here after that run.

The emulator exposed that GitHub Release downloads are blocked by WebView CORS
after GitHub redirects to its asset host. Capacitor's bundled native HTTP fetch
patch is enabled for release downloads; the existing compressed SHA-256 check
and atomic SQLite transaction remain the trust and rollback boundary.

## 2026-08-20 — M9 mobile corpus delivery and durable profile settings

**Status:** approved

The mobile corpus is delivered as gzip-compressed JSON Lines rather than a
prebuilt SQLite file. JSON Lines keeps the release artifact platform-neutral,
allows every row to be validated before insertion, and supports one atomic
transaction through the existing Capacitor SQLite connection. The curated
artifact contains 7,200 puzzles and is 383,839 bytes compressed, so verifying
the compressed SHA-256 before decompression remains safely bounded on the
target device. Import is user-initiated, reports download/import progress, and
records `corpus_version` and `corpus_sha256` only in the successful transaction.

Selection scans the full official Lichess CC0 corpus and uses reservoir
sampling across 48 balance cells: six seedable weakness categories, short and
long ply buckets, and four rating bands from 800 through 2200. Each category
contains 1,200 puzzles (600 short, 600 long), producing a non-arbitrary spread
without shipping the multi-million-row source corpus to the phone.

Profile preferences are rows in a mobile SQLite `settings` table. They are not
stored in localStorage. Engine skill is read before constructing the
`TrainingOrchestrator` and is passed into every new `PracticeSession`. Resetting
training data removes games, moves, classifications, weakness tags, and
settings while preserving the rebuildable downloaded corpus; corpus replacement
has its own explicit re-download control.

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

## 2026-08-15 — M4 imported-time and source semantics

**Status:** correctness clarification for approved completed-game import

Completed chess.com imports persist the user's matched color, both player
names, import source, and a stable external ID for deduplication. A PGN without
a completed result or with a non-standard variant is rejected before engine or
database work. Since ordinary PGN does not establish the wall-clock time of
each ply, imported move `timestamp` records local evaluation time and is
explicitly labelled `timestamp_source='posthoc_analysis'`; historical move
times are never invented.

## 2026-08-16 — M7 Capacitor mobile platform and Chess.com mobile theming

**Status:** approved

The primary platform target is transitioned to Capacitor (iOS/Android) while
maintaining Electron desktop support in secondary priority.

Key decisions:
1. **Parallel Storage Architecture:** To avoid breaking the maintained Electron
   desktop path, `/storage/db.js` and `/data/puzzleDb.js` remain intact with
   synchronous `node:sqlite`. Parallel async modules (`/storage/mobileDb.js`
   and `/storage/mobilePuzzleDb.js`) provide the async `@capacitor-community/sqlite`
   implementations for mobile WebViews.
2. **Dependency-Injected Orchestrator:** `TrainingOrchestrator` in `/core/orchestrator.js`
   accepts an injected storage adapter, executing `await` on storage methods so it
   seamlessly supports both synchronous and asynchronous backends without code duplication.
3. **Chess.com Mobile DOM Structure:** Inspection confirms Chess.com mobile web layout
   uses the same `<wc-chess-board>` and `<chess-board>` web component host elements
   and `.piece.[color][type]` classes (e.g. `.piece.wp`, `.piece.bk`) as desktop.
   However, coordinate labels and board dimensions use responsive CSS variables
   (e.g., `--custom-board-size`). The visual theme injection overlay targets:
   - Board container: `wc-chess-board, chess-board, .board`
   - Piece assets: `.piece.wp`, `.piece.wn`, `.piece.wb`, `.piece.wr`, `.piece.wq`, `.piece.wk` and black counterparts
   - Theme-only rule strictly maintained: no board reading, no move assistance.
   Live API 35 emulator inspection on 2026-08-20 found that the current
   `wc-chess-board.board` paints its squares with a host `background-image`
   (`assets-themes.chess.com`) rather than child `.light`/`.dark` nodes. The
   overlay therefore replaces that image with a CSS-only 8x8 `conic-gradient`
   on the host while retaining the older square selectors as compatibility
   fallbacks. No position, piece, move, clock, account, or game data is returned
   to the app.

## 2026-08-16 — M8 Orange Cat Theme & Feature Completion

**Status:** approved

Research-driven visual design tokens and complete end-to-end practice wiring
have been completed for the mobile phone APK handoff.

### 1. Research-Driven Orange Tabby Theme Tokens
- **Inspiration:** Researched natural ginger tabby coat patterns (warm ginger
  marmalade, terracotta stripe accents, warm cream underbelly) and playful UI
  aesthetics from apps like Forest, Duolingo, and cozy pet apps.
- **Color Palette:**
  - Canvas Background: `#FAF6F0` (warm kitten cream) / gradient to `#F5EDE2`
  - Cards & Surface: `#FFFDF9` (warm milk ivory) / elevated `#FFF7EE`
  - Interactive & Borders: `#F4E8DB` / `#EADCCE`
  - Primary Ginger: `#E67E22` (vibrant tabby orange) / `#D35400` (deep marmalade)
  - Tabby Stripe Terracotta: `#8D5B4C` / `#6E3D30`
  - High-Contrast Text: `#2C241E` (charcoal espresso ink for maximum readability on cream)
  - Muted Text: `#7D7166` (warm fur grey)
  - Board Light Squares: `#F7EFE2` (soft cream paw square)
  - Board Dark Squares: `#C8854E` (cinnamon tabby square)
  - Board Frame: `#7A4526`
  - Selection Highlight: `rgba(230, 126, 34, 0.52)` (sunlight glow)
  - Last Move Highlight: `rgba(243, 156, 18, 0.42)`
  - Legal Target Indicator: `rgba(110, 61, 48, 0.32)` (paw dot)
- **Typography:** Selected Google Font `Nunito` for its friendly, rounded geometry
  coupled with high x-height and exceptional readability on mobile viewports.
- **Piece Silhouettes:** Standard instantly recognizable chess piece shapes are
  strictly preserved (no custom cat silhouettes during active play). Styling
  applies warm ivory/charcoal tones with subtle drop shadows and soft amber accents.
- **Playful Microcopy with Clarity:** Maintained clear functional labels with
  playful cat-voice accents (e.g. "Pounce on Weakness (Start-Slow)", "Next Fish Seed (2/2)",
  "Current Hunt: Tactical Motifs", "End Session").

### 2. Practice Board End-to-End Wiring
- Wired `startTargetedSession()` -> interactive practice turns against Stockfish 18 Lite
  -> `completeSession()` -> persistence to storage and `getNextFocus()` updates.
- Future moves preview panel active exclusively in practice mode per spec.

### 3. Chess.com Mobile Visual Overlay
- `www/chesscom-theme.css` provides a theme-only visual overlay targeting
  `wc-chess-board`, `chess-board`, `.board`, `.light`, `.dark`, and `.highlight`
  without reading board state or providing live assistance.
