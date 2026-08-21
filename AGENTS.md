# AGENTS.md — Read this before touching anything

This file is loaded automatically. It contains the rules that have caused
real bugs when violated. Read it, then read SPEC.md, then read the task.

---

## The build rule that broke this project once already

`npm run build:web` MUST run before every `npx cap sync`.
Use `npm run cap:sync` — it chains them.

WHY: `capacitor.config.json` sets `webDir: "www"`. Capacitor ships ONLY
that folder into the APK. Engine, core, data, and storage all live outside
it. Skip the build step and the APK ships stale code silently — no error,
wrong behavior on the device.

## The test rule that let a broken app pass every review

Every feature needs a test in `test/appWiring.test.js` that boots the REAL
entry point. Unit tests of an isolated module are NOT sufficient evidence
that the app uses it. This is exactly how a 628-line standalone prototype
with hand-rolled chess rules shipped to a real device while all 74 module
tests passed green.

## Architecture: never break these

- `chess.js` owns ALL move legality. Never reimplement check detection,
  castling, en passant, or promotion by hand.
- `core/orchestrator.js` takes `storage` as a required arg. It must NEVER
  statically import `storage/db.js` — that import makes the module graph
  unloadable in any browser.
- `storage/db.js` and `data/puzzleDb.js` are the DESKTOP path: sync,
  node:sqlite. Do not make them async.
- `storage/mobileDb.js` and `storage/mobilePuzzleDb.js` are the MOBILE
  path: async, @capacitor-community/sqlite.

## Domain: never break these

- Taxonomy is FROZEN: tactical | king_safety | pawn_structure |
  piece_activity | positional_judgment | endgame_technique | practical_time
- Mate-pattern tags → tactical. NOT king_safety. (Was wrong once; do not
  regress.)
- practical_time is never seedable — no Lichess motifs map to it.
- Step count = PLY count (Moves.split(' ').length). NOT move pairs.
- Eval delta = (-after - before). Stockfish reports relative to side to
  move; naive subtraction is wrong-signed every other ply.
- Win percentage formula (use this, not raw cp):
  winPercent(cp) = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
  Handle mate scores separately — never feed ±100000 into the sigmoid.
- Engine difficulty: UCI_LimitStrength + UCI_Elo. NOT Skill Level.

## Assistance rules

chess.com surface: absolutely no assistance, no exceptions, no board
reading. Theme-only CSS injection.

Offline vs our own Stockfish: assistance allowed. This is a training tool.

Every game records assistance_level from ACTUAL USAGE (not settings).
Weakness analysis filters WHERE assistance_level = 'none'.

reasoning_mode (Deep Practice) is a SEPARATE dimension from
assistance_level. Deep Practice with hints off stays assistance='none'.

## Reporting

docs/verification/<MILESTONE>.md, PASS/PARTIAL/PENDING per claim.
Report only what you actually ran. PENDING is correct and honest.
Do not merge your own PRs.
