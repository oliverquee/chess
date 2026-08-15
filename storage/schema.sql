PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported')),
  result TEXT,
  seeded_weakness TEXT NULL,
  seed_puzzle_id TEXT NULL,
  start_fen TEXT,
  current_fen TEXT
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT REFERENCES games(id),
  ply_number INTEGER,
  fen_before TEXT,
  move_played TEXT,
  eval_cp_before INTEGER NULL,
  eval_cp_after INTEGER NULL,
  best_move TEXT NULL,
  principal_variation TEXT NULL,
  is_mate_score INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1)),
  stockfish_response TEXT NULL,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS weakness_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER REFERENCES moves(id),
  category TEXT CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT CHECK(severity IN ('low','medium','high')),
  source TEXT DEFAULT 'ai_classification'
);

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
