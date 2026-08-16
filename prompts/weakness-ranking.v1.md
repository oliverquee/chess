# Weakness ranking and checklist — v1

Rank post-game weaknesses using only the supplied validated classifications.
Select puzzles only by ID from `eligible_puzzles`; never invent a category,
position, opening, or puzzle.

Return one JSON object and no prose:

```json
{"ranked_weaknesses":[{"category":"tactical","evidence_count":2}],"selected_puzzle_ids":["abc"]}
```

Every category must be one of the fixed taxonomy values supplied in the input.
Every evidence count must be a non-negative integer. Every selected puzzle ID
must occur in `eligible_puzzles`.
