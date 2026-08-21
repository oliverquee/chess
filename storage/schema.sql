PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported','freeplay')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','in_progress','completed','analyzed')),
  result TEXT,
  seeded_weakness TEXT NULL,
  seed_puzzle_id TEXT NULL,
  start_fen TEXT,
  current_fen TEXT,
  import_source TEXT NULL,
  external_game_id TEXT NULL,
  player_color TEXT NULL CHECK(player_color IN ('white','black')),
  white_player TEXT NULL,
  black_player TEXT NULL,
  analysis_engine TEXT NULL,
  analysis_depth INTEGER NULL,
  assistance_level TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full')),
  hint_count INTEGER NOT NULL DEFAULT 0,
  takeback_count INTEGER NOT NULL DEFAULT 0,
  time_control TEXT NULL,
  persona TEXT NULL
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
  best_move_depth8 TEXT NULL,
  principal_variation TEXT NULL,
  is_mate_score INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1)),
  stockfish_response TEXT NULL,
  time_to_move_ms INTEGER NULL,
  clock_remaining_ms INTEGER NULL,
  timestamp TEXT,
  timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
    CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  accuracy_component REAL NOT NULL,
  motif_component REAL NOT NULL,
  hint_penalty REAL NOT NULL,
  total_score REAL NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  goal_target INTEGER NOT NULL DEFAULT 3,
  goal_met INTEGER NOT NULL DEFAULT 0 CHECK(goal_met IN (0,1)),
  total_score REAL NOT NULL DEFAULT 0,
  streak_day_counted INTEGER NOT NULL DEFAULT 0 CHECK(streak_day_counted IN (0,1))
);

CREATE TABLE IF NOT EXISTS streak_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  freezes_remaining INTEGER NOT NULL DEFAULT 2,
  freezes_month TEXT NULL,
  last_counted_date TEXT NULL
);

CREATE TABLE IF NOT EXISTS category_mastery (
  category TEXT PRIMARY KEY CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  mastery_level INTEGER NOT NULL DEFAULT 0 CHECK(mastery_level BETWEEN 0 AND 5),
  last_practiced_at TEXT NULL,
  decay_checked_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS hint_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  fen TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('warm','warmer','hot')),
  detector TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  detector TEXT NOT NULL,
  result_json TEXT NOT NULL,
  games_analyzed INTEGER NOT NULL,
  moves_analyzed INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_detector ON analysis_results(detector);

