# M10 verification — Ten animal piece themes

Date: 2026-08-20

## Implemented

- Ten selectable themes: Orange Cat, Panda, Black Cat, Bunny, Fox, Corgi,
  Koala, Raccoon, Otter, and Red Panda.
- Each theme includes 12 transparent 128×128 PNG sprites: six roles for the
  light army and six roles for the dark army (120 assets total).
- The practice-board renderer selects sprites from the persisted theme and
  falls back to standard Unicode chess pieces if an image fails to load.
- The existing board palette, app shell, profile mascot, and visual-only
  Chess.com CSS skin follow the same selected theme.

## Evidence executed

| Check | Result | Status |
| --- | --- | --- |
| Automated suite | 97 tests passed, 0 failed | PASS |
| Asset completeness | All 120 expected theme/color/role paths exist | PASS |
| Android build | Gradle 8.14.3 produced a 24,534,534-byte debug APK | PASS |
| Emulator install/upgrade | Installed with `adb install --no-streaming -r` on API 35 | PASS |
| Ten-theme render sweep | Every theme activated; all 32 starting pieces loaded at natural width 128; zero failed images | PASS |
| Persistence | Red Panda remained selected after force-stop/relaunch | PASS |
| Seed 1 Stockfish turn | User `Ra1`; exactly one reply `...Rb8+`; control returned | PASS |
| Seed 2 handoff and turn | Seed 2 loaded; user `Qe1+`; exactly one reply `...Rxe1`; control returned | PASS |
| Board flip | Existing renderer and automated legality suite remain green | PASS |
| Corpus and profile | Existing native corpus remained at 7,200 puzzles; profile exposed all ten options | PASS |
| Physical Fold3 discovery | `SM-F926B` was initially authorized, then disappeared before APK installation | PENDING |

## Scope boundary

The Chess.com integration remains visual-only. The selected palette can be
injected into the embedded Chess.com page, but the custom animal PNG pieces are
used by the local practice renderer only. The app does not read or replace live
Chess.com piece elements, inspect positions, or provide live assistance.
