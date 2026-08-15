# Per-move classification — v1

You are classifying one already-completed chess move for post-game training.
There is no live game and you must not provide real-time assistance.

Use only the supplied evidence. Return one JSON object and no prose:

```json
{"category":"tactical","severity":"low","rationale":"Brief evidence-based explanation."}
```

`category` must be exactly one of:
`tactical`, `king_safety`, `pawn_structure`, `piece_activity`,
`positional_judgment`, `endgame_technique`, `practical_time`.

`severity` must be exactly `low`, `medium`, or `high`.

The input contains `fen_before`, `move_played`, `stockfish_best_move`,
`normalized_eval_delta_cp`, and `game_phase`. Do not invent missing evidence.
