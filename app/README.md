# Electron app

Run with:

```text
npm start
```

The trusted main process opens `history.sqlite` under Electron's user-data
directory. It expects the rebuildable puzzle corpus at
`lichess-puzzles.sqlite` in the same directory; a separately imported database
can be selected at launch with `CHESS_PUZZLE_DB_PATH=/absolute/path/to/db`.

The local renderer is sandboxed and reaches the main process only through the
fixed preload API. Claude secrets are accepted write-only from the renderer and
encrypted with `safeStorage`; Electron's Linux `basic_text` fallback is
rejected. The chess.com window has its own session partition and no preload.
Its only integration is fail-soft `insertCSS`.

Theme packs live in `app/themes/registry.js`. They contain validated hex-color
tokens and a 12-piece artwork map only; invalid or missing packs fall back to
cat. The current piece maps are Unicode placeholders for later final cat/panda
artwork and do not require any change to game logic.

`CHESS_ANALYST_SMOKE=1` is a verification mode: after the local window loads it
prints the observed web preferences and exits. It does not weaken production
settings. A root-only CI container may require Chromium's `--no-sandbox` merely
to start the binary; never use that switch for the normal desktop app.
