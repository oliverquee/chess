PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','in_progress','completed','analyzed')),
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

CREATE TABLE IF NOT EXISTS move_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER NOT NULL REFERENCES moves(id),
  status TEXT NOT NULL CHECK(status IN ('classified','unclassified')),
  category TEXT NULL CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT NULL CHECK(severity IN ('low','medium','high')),
  rationale TEXT NULL,
  error TEXT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 2),
  model_used TEXT NOT NULL,
  backend TEXT NOT NULL CHECK(backend IN ('claude','ollama')),
  prompt_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  analysis_timestamp TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  CHECK(
    (status = 'classified' AND category IS NOT NULL AND severity IS NOT NULL AND rationale IS NOT NULL)
    OR
    (status = 'unclassified' AND category IS NULL AND severity IS NULL AND error IS NOT NULL)
  )
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
  source TEXT DEFAULT 'ai_classification',
  classification_id INTEGER NULL REFERENCES move_classifications(id)
);

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
