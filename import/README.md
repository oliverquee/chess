# Completed chess.com import

This directory has exactly two post-game inputs:

- a manually exported, completed PGN;
- Chess.com's read-only complete monthly PubAPI archive.

There is deliberately no current-games endpoint, browser integration, DOM
reader, board-state reader, webContents hook, or live assistance path. Standard
variant, completed result, and user-color validation all occur before Stockfish
is created. Stockfish then evaluates the immutable PGN locally, and SQLite is
written only after every ply succeeds.

`timestamp_source='posthoc_analysis'` distinguishes the evaluation time from a
historical per-move clock time that the PGN does not prove.
