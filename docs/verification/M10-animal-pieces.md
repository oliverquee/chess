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
| Android build | Gradle 8.14.3 produced a 24,611,006-byte debug APK (`SHA-256 8325ADC4E83F6E75CF8B7794D69CBB307D775D1045C6F02F804756EC8C6702F2`) | PASS |
| Emulator install/upgrade | Installed with `adb install --no-streaming -r` on API 35 | PASS |
| Ten-theme render sweep | Every theme activated; all 32 starting pieces loaded at natural width 128; zero failed images | PASS |
| Persistence | Red Panda remained selected after force-stop/relaunch | PASS |
| Seed 1 Stockfish turn | User `Ra1`; exactly one reply `...Rb8+`; control returned | PASS |
| Seed 2 handoff and turn | Seed 2 loaded; user `Qe1+`; exactly one reply `...Rxe1`; control returned | PASS |
| Board flip | Existing renderer and automated legality suite remain green | PASS |
| Corpus and profile | Existing native corpus remained at 7,200 puzzles; profile exposed all ten options | PASS |
| Physical Fold3 discovery | Authorized `SM-F926B` available as serial `R3CT60CV7ZX` | PASS |
| Dark-sprite visual integrity | Physical capture exposed incomplete dark sprites; all 60 were repaired from their complete themed silhouettes and passed alpha-bounds review | PASS |
| Dark-piece contrast | Added a warm ivory silhouette outline to all 60 dark-side sprites; verified against both light and dark Red Panda board squares on the Android emulator | PASS |
| Physical Fold3 install/upgrade | Installed in place on authorized `SM-F926B` (`R3CT60CV7ZX`); cold launch succeeded with no fatal runtime exception | PASS |
| Physical corpus import | One-time puzzle pack downloaded and imported to the Fold3; both queued seeds loaded afterward | PASS |
| Physical ten-theme sweep | All ten themes activated; every piece in the live position loaded at 128×128 with zero failed images | PASS |
| Physical persistence | Red Panda remained selected after force-stop/cold launch; 32 pieces loaded with zero failures | PASS |
| Physical Seed 1 Stockfish turn | User `Qxa8`; exactly one reply `...Qxb6+`; control returned | PASS |
| Physical Seed 2 Stockfish turn | User `Be8`; exactly one reply `...Rxe8`; control returned | PASS |
| Physical Chess.com WebView | Embedded Chess.com New Game page opened with the app's board palette overlay; host activity remained healthy | PASS |

## Scope boundary

The Chess.com integration remains visual-only. The selected palette can be
injected into the embedded Chess.com page, but the custom animal PNG pieces are
used by the local practice renderer only. The app does not read or replace live
Chess.com piece elements, inspect positions, or provide live assistance.
