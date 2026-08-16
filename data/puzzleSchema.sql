PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS puzzles (
  puzzle_id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating INTEGER,
  step_count INTEGER NOT NULL CHECK(step_count > 0)
);

CREATE TABLE IF NOT EXISTS puzzle_themes (
  theme TEXT NOT NULL,
  puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
  PRIMARY KEY (theme, puzzle_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_puzzles_step_count ON puzzles(step_count);
CREATE INDEX IF NOT EXISTS idx_puzzle_themes_puzzle_id ON puzzle_themes(puzzle_id);
