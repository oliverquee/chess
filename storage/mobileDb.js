/**
 * This is the mobile/Capacitor async equivalent of db.js.
 * It provides the same API as db.js, but uses the async @capacitor-community/sqlite plugin.
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const SCHEMA_SQL = `
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
  principal_variation TEXT NULL,
  is_mate_score INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1)),
  stockfish_response TEXT NULL,
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

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
`;

const ALLOWED_MODES = new Set(['practice', 'imported', 'freeplay']);
const SESSION_TRANSITIONS = Object.freeze({
  queued: 'in_progress',
  in_progress: 'completed',
  completed: 'analyzed',
});
const WEAKNESS_CATEGORIES = new Set([
  'tactical',
  'king_safety',
  'pawn_structure',
  'piece_activity',
  'positional_judgment',
  'endgame_technique',
  'practical_time',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);
const ANALYSIS_BACKENDS = new Set(['claude', 'ollama']);
const SETTING_DEFAULTS = Object.freeze({
  display_name: '',
  cat_avatar: 'orange-tabby',
  chesscom_username: 'lastautumnleaf1',
  engine_skill_level: '10',
  theme: 'cat',
  daily_goal: '3',
  rated_practice: 'false',
  preview_depth: '3',
  freeplay_persona: 'tabby',
  freeplay_time_control: '5|0',
  freeplay_color: 'random',
});
const SETTING_KEYS = new Set(Object.keys(SETTING_DEFAULTS));

function assertDb(db) {
  if (!db || typeof db.execute !== 'function' || typeof db.run !== 'function' || typeof db.query !== 'function') {
    throw new TypeError('db must be a CapacitorSQLite connection.');
  }
}

function validateSessionHeader(summary) {
  if (!summary || typeof summary !== 'object') throw new TypeError('summary must be an object.');
  if (typeof summary.id !== 'string' || !summary.id.trim()) throw new TypeError('summary.id must be a non-empty string.');
  if (!ALLOWED_MODES.has(summary.mode)) throw new RangeError(`Unsupported game mode: ${summary.mode}`);
  if (!Array.isArray(summary.moves)) throw new TypeError('summary.moves must be an array.');
}

function normalizeNullableInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) throw new TypeError(`${fieldName} must be an integer or null.`);
  return value;
}

function normalizeNullableText(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a string or null.`);
  return value;
}

function normalizeMateFlag(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === null || value === undefined) return 0;
  throw new TypeError('move.is_mate_score must be 0, 1, boolean, null, or undefined.');
}

function validateMove(move, gameId) {
  if (!move || typeof move !== 'object') throw new TypeError('Each move must be an object.');
  if (move.game_id !== gameId) {
    throw new Error(`Move game_id ${move.game_id} does not match session id ${gameId}.`);
  }
  if (!Number.isInteger(move.ply_number) || move.ply_number < 1) {
    throw new TypeError('move.ply_number must be a positive integer.');
  }
  for (const field of ['fen_before', 'move_played', 'timestamp']) {
    if (typeof move[field] !== 'string' || !move[field]) {
      throw new TypeError(`move.${field} must be a non-empty string.`);
    }
  }

  normalizeNullableInteger(move.eval_cp_before, 'move.eval_cp_before');
  normalizeNullableInteger(move.eval_cp_after, 'move.eval_cp_after');
  normalizeNullableText(move.best_move, 'move.best_move');
  normalizeNullableText(move.principal_variation, 'move.principal_variation');
  normalizeMateFlag(move.is_mate_score);

  if (move.stockfish_response !== null && move.stockfish_response !== undefined && typeof move.stockfish_response !== 'string') {
    throw new TypeError('move.stockfish_response must be a string or null.');
  }
}

function timestampSourceFor(move, mode) {
  const expected = mode === 'imported' ? 'posthoc_analysis' : 'live_recorded';
  const value = move.timestamp_source ?? expected;
  if (value !== expected) {
    throw new Error(`move.timestamp_source must be ${expected} for mode=${mode}.`);
  }
  return value;
}

async function withTransaction(db, operation) {
  const usesNativeTransactionApi = typeof db.beginTransaction === 'function'
    && typeof db.commitTransaction === 'function'
    && typeof db.rollbackTransaction === 'function';
  if (usesNativeTransactionApi) await db.beginTransaction();
  else await db.execute('BEGIN IMMEDIATE');
  try {
    const transactionDb = usesNativeTransactionApi
      ? {
          run: (statement, values = []) => db.run(statement, values, false),
          execute: (statements) => db.execute(statements, false),
          query: db.query.bind(db),
        }
      : db;
    const result = await operation(transactionDb);
    if (usesNativeTransactionApi) await db.commitTransaction();
    else await db.execute('COMMIT');
    return result;
  } catch (error) {
    try {
      if (usesNativeTransactionApi) await db.rollbackTransaction();
      else await db.execute('ROLLBACK');
    } catch {
      // Preserve the original failure; rollback errors are secondary.
    }
    throw error;
  }
}

async function ensureMoveAnalysisColumns(db) {
  const res = await db.query('PRAGMA table_info(moves)');
  const columns = new Set((res.values || []).map((column) => column.name));
  const hadLegacyEval = columns.has('eval_cp');

  const additions = [
    ['eval_cp_before', 'INTEGER NULL'],
    ['eval_cp_after', 'INTEGER NULL'],
    ['best_move', 'TEXT NULL'],
    ['principal_variation', 'TEXT NULL'],
    ['is_mate_score', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1))'],
  ];

  for (const [name, sqlType] of additions) {
    if (!columns.has(name)) {
      await db.execute(`ALTER TABLE moves ADD COLUMN ${name} ${sqlType}`);
      columns.add(name);
    }
  }

  if (hadLegacyEval) {
    await db.execute('UPDATE moves SET eval_cp_before = eval_cp WHERE eval_cp_before IS NULL AND eval_cp IS NOT NULL');
  }
}

async function ensureGameStatusColumn(db) {
  const res = await db.query('PRAGMA table_info(games)');
  const columns = new Set((res.values || []).map((column) => column.name));
  if (!columns.has('status')) {
    await db.execute(`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
      CHECK(status IN ('queued','in_progress','completed','analyzed'))`);
  }
}

async function ensureImportColumns(db) {
  const gameRes = await db.query('PRAGMA table_info(games)');
  const gameColumns = new Set((gameRes.values || []).map((column) => column.name));
  const gameAdditions = [
    ['import_source', 'TEXT NULL'],
    ['external_game_id', 'TEXT NULL'],
    ['player_color', "TEXT NULL CHECK(player_color IN ('white','black'))"],
    ['white_player', 'TEXT NULL'],
    ['black_player', 'TEXT NULL'],
    ['analysis_engine', 'TEXT NULL'],
    ['analysis_depth', 'INTEGER NULL'],
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) await db.execute(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }

  const moveRes = await db.query('PRAGMA table_info(moves)');
  const moveColumns = new Set((moveRes.values || []).map((column) => column.name));
  if (!moveColumns.has('timestamp_source')) {
    await db.execute(`ALTER TABLE moves ADD COLUMN timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
      CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))`);
  }
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_games_import_identity
    ON games(import_source, external_game_id)
    WHERE import_source IS NOT NULL AND external_game_id IS NOT NULL`);
}

async function ensureWeaknessClassificationColumn(db) {
  const res = await db.query('PRAGMA table_info(weakness_tags)');
  const columns = new Set((res.values || []).map((column) => column.name));
  if (!columns.has('classification_id')) {
    await db.execute('ALTER TABLE weakness_tags ADD COLUMN classification_id INTEGER NULL REFERENCES move_classifications(id)');
  }
}

async function ensureM10ColumnsAndTables(db) {
  const gameRes = await db.query('PRAGMA table_info(games)');
  const gameColumns = new Set((gameRes.values || []).map((column) => column.name));
  const gameAdditions = [
    ['assistance_level', "TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full'))"],
    ['hint_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['takeback_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['time_control', 'TEXT NULL'],
    ['persona', 'TEXT NULL'],
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) await db.execute(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }

  await db.execute(`
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
    CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
    CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
  `);
}

async function insertMoves(db, summary) {
  const insertMoveSql = `
    INSERT INTO moves (
      game_id,
      ply_number,
      fen_before,
      move_played,
      eval_cp_before,
      eval_cp_after,
      best_move,
      principal_variation,
      is_mate_score,
      stockfish_response,
      timestamp,
      timestamp_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (const [index, move] of summary.moves.entries()) {
    validateMove(move, summary.id);
    if (move.ply_number !== index + 1) {
      throw new Error(`Expected ply_number ${index + 1}, received ${move.ply_number}.`);
    }
    await db.run(
      insertMoveSql,
      [
        summary.id,
        move.ply_number,
        move.fen_before,
        move.move_played,
        normalizeNullableInteger(move.eval_cp_before, 'move.eval_cp_before'),
        normalizeNullableInteger(move.eval_cp_after, 'move.eval_cp_after'),
        normalizeNullableText(move.best_move, 'move.best_move'),
        normalizeNullableText(move.principal_variation, 'move.principal_variation'),
        normalizeMateFlag(move.is_mate_score),
        move.stockfish_response ?? null,
        move.timestamp,
        timestampSourceFor(move, summary.mode),
      ]
    );
  }
}

export async function initDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');

  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(path, false, "no-encryption", 1, false);
  await db.open();

  await db.execute('PRAGMA foreign_keys = ON;');
  
  const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const statement of statements) {
    await db.execute(statement + ';');
  }

  await ensureGameStatusColumn(db);
  await ensureMoveAnalysisColumns(db);
  await ensureWeaknessClassificationColumn(db);
  await ensureImportColumns(db);
  await ensureM10ColumnsAndTables(db);
  
  return db;
}

export async function saveGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);

  const insertGameSql = `
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
      import_source, external_game_id, player_color, white_player, black_player,
      analysis_engine, analysis_depth,
      assistance_level, hint_count, takeback_count, time_control, persona
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const date = summary.date ?? summary.moves[0]?.timestamp ?? new Date().toISOString();

  return withTransaction(db, async (transactionDb) => {
    await transactionDb.run(insertGameSql, [
      summary.id,
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
      summary.import_source ?? null,
      summary.external_game_id ?? null,
      summary.player_color ?? null,
      summary.white_player ?? null,
      summary.black_player ?? null,
      summary.analysis_engine ?? null,
      summary.analysis_depth ?? null,
      summary.assistance_level ?? 'none',
      summary.hint_count ?? 0,
      summary.takeback_count ?? 0,
      summary.time_control ?? null,
      summary.persona ?? null,
    ]);

    await insertMoves(transactionDb, summary);

    return summary.id;
  });
}

function validateQueuedGame(game) {
  if (!game || typeof game !== 'object') throw new TypeError('game must be an object.');
  if (typeof game.id !== 'string' || !game.id) throw new TypeError('game.id must be a non-empty string.');
  if (typeof game.start_fen !== 'string' || !game.start_fen) throw new TypeError('game.start_fen must be a non-empty string.');
}

export async function createQueuedGames(db, games) {
  assertDb(db);
  if (!Array.isArray(games) || games.length === 0) {
    throw new TypeError('games must be a non-empty array.');
  }
  games.forEach(validateQueuedGame);
  
  const insertSql = `
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen
    ) VALUES (?, ?, 'practice', 'queued', NULL, ?, ?, ?, ?)
  `;

  return withTransaction(db, async (transactionDb) => {
    const ids = [];
    for (const game of games) {
      await transactionDb.run(insertSql, [
        game.id,
        game.date ?? new Date().toISOString(),
        game.seeded_weakness ?? null,
        game.seed_puzzle_id ?? null,
        game.start_fen,
        game.start_fen,
      ]);
      ids.push(game.id);
    }
    return ids;
  });
}

export async function createQueuedGame(db, game) {
  const ids = await createQueuedGames(db, [game]);
  return ids[0];
}

export async function getGameStatus(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  
  const res = await db.query('SELECT status FROM games WHERE id = ?', [gameId]);
  if (!res.values || res.values.length === 0) throw new Error(`Game not found: ${gameId}`);
  return res.values[0].status;
}

export async function transitionGameStatus(db, gameId, nextStatus) {
  const current = await getGameStatus(db, gameId);
  const expected = SESSION_TRANSITIONS[current];
  if (nextStatus !== expected) {
    throw new Error(`Invalid game status transition: ${current} → ${nextStatus}. Expected ${expected ?? 'no further transition'}.`);
  }
  
  const result = await db.run('UPDATE games SET status = ? WHERE id = ? AND status = ?', [nextStatus, gameId, current]);
  if (Number(result.changes?.changes) !== 1) throw new Error(`Game status changed concurrently: ${gameId}`);
  return nextStatus;
}

export async function completeGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);
  const date = summary.moves[0]?.timestamp ?? new Date().toISOString();

  return withTransaction(db, async (transactionDb) => {
    const result = await transactionDb.run(`
      UPDATE games
      SET date = ?, mode = ?, status = 'completed', result = ?,
          seeded_weakness = ?, seed_puzzle_id = ?, start_fen = ?, current_fen = ?,
          assistance_level = ?, hint_count = ?, takeback_count = ?, time_control = ?, persona = ?
      WHERE id = ? AND status = 'in_progress'
    `, [
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
      summary.assistance_level ?? 'none',
      summary.hint_count ?? 0,
      summary.takeback_count ?? 0,
      summary.time_control ?? null,
      summary.persona ?? null,
      summary.id,
    ]);
    
    if (Number(result.changes?.changes) !== 1) {
      const res = await transactionDb.query('SELECT status FROM games WHERE id = ?', [summary.id]);
      const current = res.values && res.values.length > 0 ? res.values[0].status : null;
      throw new Error(`Cannot complete game ${summary.id} from status ${current ?? 'missing'}.`);
    }
    await insertMoves(transactionDb, summary);
    return summary.id;
  });
}

export async function getGameHistory(db, { limit, weaknessCategory } = {}) {
  assertDb(db);

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError('limit must be a positive integer when provided.');
  }
  if (weaknessCategory !== undefined && weaknessCategory !== null && typeof weaknessCategory !== 'string') {
    throw new TypeError('weaknessCategory must be a string, null, or undefined.');
  }

  const where = weaknessCategory === undefined
    ? ''
    : weaknessCategory === null
      ? ' WHERE seeded_weakness IS NULL'
      : ' WHERE seeded_weakness = ?';
  const limitClause = limit === undefined ? '' : ' LIMIT ?';
  const sql = `
    SELECT id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
           import_source, external_game_id, player_color, white_player, black_player,
           analysis_engine, analysis_depth,
           assistance_level, hint_count, takeback_count, time_control, persona
    FROM games
    ${where}
    ORDER BY date DESC, rowid DESC
    ${limitClause}
  `;

  const params = [];
  if (weaknessCategory !== undefined && weaknessCategory !== null) params.push(weaknessCategory);
  if (limit !== undefined) params.push(limit);

  const gamesRes = await db.query(sql, params);
  const games = gamesRes.values || [];

  const movesSql = `
    SELECT
      id, game_id, ply_number, fen_before, move_played, eval_cp_before,
      eval_cp_after, best_move, principal_variation, is_mate_score,
      stockfish_response, timestamp, timestamp_source
    FROM moves
    WHERE game_id = ?
    ORDER BY ply_number ASC, id ASC
  `;

  const result = [];
  for (const game of games) {
    const movesRes = await db.query(movesSql, [game.id]);
    result.push({
      ...game,
      moves: (movesRes.values || []).map((move) => ({ ...move })),
    });
  }
  return result;
}

export async function getGameById(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  
  const gameRes = await db.query(`
    SELECT id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
           import_source, external_game_id, player_color, white_player, black_player,
           analysis_engine, analysis_depth,
           assistance_level, hint_count, takeback_count, time_control, persona
    FROM games WHERE id = ?
  `, [gameId]);
  
  if (!gameRes.values || gameRes.values.length === 0) throw new Error(`Game not found: ${gameId}`);
  const game = gameRes.values[0];

  const movesRes = await db.query(`
    SELECT id, game_id, ply_number, fen_before, move_played, eval_cp_before,
           eval_cp_after, best_move, principal_variation, is_mate_score,
           stockfish_response, timestamp, timestamp_source
    FROM moves WHERE game_id = ? ORDER BY ply_number ASC, id ASC
  `, [gameId]);
  
  const moves = movesRes.values || [];
  return { ...game, moves: moves.map((move) => ({ ...move })) };
}

export async function saveWeaknessTags(db, moveId, tags) {
  assertDb(db);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError('moveId must be a positive integer.');

  const normalizedTags = Array.isArray(tags) ? tags : [tags];
  if (normalizedTags.length === 0 || normalizedTags.some((tag) => !tag || typeof tag !== 'object')) {
    throw new TypeError('tags must contain one or more tag objects.');
  }

  const insertTagSql = `
    INSERT INTO weakness_tags (move_id, category, severity, source)
    VALUES (?, ?, ?, ?)
  `;

  return withTransaction(db, async (transactionDb) => {
    const ids = [];
    for (const tag of normalizedTags) {
      if (typeof tag.category !== 'string' || !tag.category) throw new TypeError('tag.category must be a non-empty string.');
      if (typeof tag.severity !== 'string' || !tag.severity) throw new TypeError('tag.severity must be a non-empty string.');
      const source = tag.source ?? 'ai_classification';
      if (typeof source !== 'string' || !source) throw new TypeError('tag.source must be a non-empty string.');

      const result = await transactionDb.run(insertTagSql, [moveId, tag.category, tag.severity, source]);
      ids.push(Number(result.changes?.lastId));
    }
    return ids;
  });
}

function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') throw new TypeError('provenance must be an object.');
  for (const field of ['model_used', 'prompt_version', 'prompt_hash', 'analysis_timestamp']) {
    if (typeof provenance[field] !== 'string' || !provenance[field]) {
      throw new TypeError(`provenance.${field} must be a non-empty string.`);
    }
  }
  if (!ANALYSIS_BACKENDS.has(provenance.backend)) {
    throw new RangeError(`Unsupported analysis backend: ${provenance.backend}`);
  }
}

export async function saveMoveClassification(db, moveId, result) {
  assertDb(db);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError('moveId must be a positive integer.');
  if (!result || typeof result !== 'object') throw new TypeError('result must be an object.');
  if (!['classified', 'unclassified'].includes(result.status)) {
    throw new RangeError(`Unsupported classification status: ${result.status}`);
  }
  if (!Number.isInteger(result.attempts) || result.attempts < 1 || result.attempts > 2) {
    throw new RangeError('result.attempts must be 1 or 2.');
  }
  validateProvenance(result.provenance);

  const value = result.value;
  if (result.status === 'classified') {
    if (!value || typeof value !== 'object') throw new TypeError('A classified result requires value.');
    if (!WEAKNESS_CATEGORIES.has(value.category)) throw new RangeError(`Unknown weakness category: ${value.category}`);
    if (!SEVERITIES.has(value.severity)) throw new RangeError(`Unknown severity: ${value.severity}`);
    if (typeof value.rationale !== 'string' || !value.rationale) throw new TypeError('value.rationale must be a non-empty string.');
  } else if (typeof result.error !== 'string' || !result.error) {
    throw new TypeError('An unclassified result requires a non-empty error.');
  }

  return withTransaction(db, async (transactionDb) => {
    const moveRes = await transactionDb.query('SELECT id FROM moves WHERE id = ?', [moveId]);
    if (!moveRes.values || moveRes.values.length === 0) throw new Error(`Move not found: ${moveId}`);
    
    await transactionDb.run('UPDATE move_classifications SET is_current = 0 WHERE move_id = ? AND is_current = 1', [moveId]);
    
    const inserted = await transactionDb.run(`
      INSERT INTO move_classifications (
        move_id, status, category, severity, rationale, error, attempts,
        model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      moveId,
      result.status,
      result.status === 'classified' ? value.category : null,
      result.status === 'classified' ? value.severity : null,
      result.status === 'classified' ? value.rationale : null,
      result.error ?? null,
      result.attempts,
      result.provenance.model_used,
      result.provenance.backend,
      result.provenance.prompt_version,
      result.provenance.prompt_hash,
      result.provenance.analysis_timestamp,
    ]);
    
    const classificationId = Number(inserted.changes?.lastId);
    if (result.status === 'classified') {
      await transactionDb.run(`
        INSERT INTO weakness_tags (move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, 'ai_classification', ?)
      `, [moveId, value.category, value.severity, classificationId]);
    }
    return classificationId;
  });
}

export async function getMoveClassifications(db, moveId, { currentOnly = false } = {}) {
  assertDb(db);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError('moveId must be a positive integer.');
  
  const sql = `
    SELECT id, move_id, status, category, severity, rationale, error, attempts,
           model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
    FROM move_classifications
    WHERE move_id = ? ${currentOnly ? 'AND is_current = 1' : ''}
    ORDER BY id ASC
  `;
  
  const res = await db.query(sql, [moveId]);
  return (res.values || []).map((row) => ({ ...row }));
}

export async function getWeaknessTally(db, { sinceGameId } = {}) {
  assertDb(db);

  let where = "WHERE (wt.classification_id IS NULL OR mc.is_current = 1) AND g.assistance_level = 'none'";
  let params = [];

  if (sinceGameId !== undefined) {
    if (typeof sinceGameId !== 'string' || !sinceGameId) {
      throw new TypeError('sinceGameId must be a non-empty string when provided.');
    }

    const anchorRes = await db.query('SELECT date, rowid AS insertion_order FROM games WHERE id = ?', [sinceGameId]);
    if (!anchorRes.values || anchorRes.values.length === 0) throw new Error(`Game not found: ${sinceGameId}`);
    const anchor = anchorRes.values[0];

    if (anchor.date === null) {
      where += ' AND g.rowid >= ?';
      params = [anchor.insertion_order];
    } else {
      where += ' AND (g.date > ? OR (g.date = ? AND g.rowid >= ?))';
      params = [anchor.date, anchor.date, anchor.insertion_order];
    }
  }

  const sql = `
    SELECT wt.category AS category, COUNT(*) AS count
    FROM weakness_tags wt
    JOIN moves m ON m.id = wt.move_id
    JOIN games g ON g.id = m.game_id
    LEFT JOIN move_classifications mc ON mc.id = wt.classification_id
    ${where}
    GROUP BY wt.category
    ORDER BY count DESC, wt.category ASC
  `;

  const res = await db.query(sql, params);
  return (res.values || []).map((row) => ({ category: row.category, count: Number(row.count) }));
}

export async function getProfileStats(db, { recentLimit = 10 } = {}) {
  assertDb(db);
  if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
    throw new RangeError('recentLimit must be an integer from 1 to 50.');
  }

  const totalsRes = await db.query(`
    SELECT
      COUNT(*) AS total_sessions,
      COALESCE(SUM(move_count), 0) AS total_moves
    FROM (
      SELECT g.id, COUNT(m.id) AS move_count
      FROM games g
      LEFT JOIN moves m ON m.game_id = g.id
      WHERE g.status IN ('completed', 'analyzed')
      GROUP BY g.id
    )
  `);
  const totals = totalsRes.values?.[0] ?? { total_sessions: 0, total_moves: 0 };

  const recentRes = await db.query(`
    SELECT g.id, g.date, g.seeded_weakness, g.result, g.status, g.assistance_level, g.persona, COUNT(m.id) AS move_count
    FROM games g
    LEFT JOIN moves m ON m.game_id = g.id
    WHERE g.status IN ('completed', 'analyzed')
    GROUP BY g.id
    ORDER BY COALESCE(g.date, '') DESC, g.rowid DESC
    LIMIT ?
  `, [recentLimit]);

  return {
    totalSessions: Number(totals.total_sessions ?? 0),
    totalMoves: Number(totals.total_moves ?? 0),
    weaknessTally: await getWeaknessTally(db),
    recentSessions: (recentRes.values || []).map((row) => ({
      ...row,
      move_count: Number(row.move_count ?? 0),
    })),
  };
}

export async function getSettings(db) {
  assertDb(db);
  const res = await db.query('SELECT key, value FROM settings');
  const settings = { ...SETTING_DEFAULTS };
  for (const row of res.values || []) {
    if (SETTING_KEYS.has(row.key)) settings[row.key] = String(row.value);
  }
  return settings;
}

export async function setSetting(db, key, value) {
  assertDb(db);
  if (!SETTING_KEYS.has(key)) throw new RangeError(`Unknown setting: ${key}`);
  const normalized = String(value ?? '').trim();
  if (key === 'engine_skill_level') {
    const level = Number(normalized);
    if (!Number.isInteger(level) || level < 0 || level > 20) {
      throw new RangeError('engine_skill_level must be an integer from 0 to 20.');
    }
  }
  if (key === 'theme' && !['cat', 'panda', 'black-cat', 'bunny', 'fox', 'corgi', 'koala', 'raccoon', 'otter', 'red-panda'].includes(normalized)) {
    throw new RangeError('Unknown animal theme.');
  }
  if (key === 'cat_avatar' && !['orange-tabby', 'tuxedo', 'calico', 'black-cat'].includes(normalized)) {
    throw new RangeError('Unknown cat avatar.');
  }
  await db.run(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, normalized]);
  return normalized;
}

export async function saveSeedScore(db, { gameId, accuracyComponent, motifComponent, hintPenalty, totalScore, computedAt = new Date().toISOString() }) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  return withTransaction(db, async (transactionDb) => {
    const res = await transactionDb.run(`
      INSERT INTO seed_scores (game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [gameId, Number(accuracyComponent), Number(motifComponent), Number(hintPenalty), Number(totalScore), computedAt]);
    return Number(res.changes?.lastId);
  });
}

export async function getSeedScore(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  const res = await db.query('SELECT * FROM seed_scores WHERE game_id = ? ORDER BY id DESC LIMIT 1', [gameId]);
  return res.values && res.values.length > 0 ? { ...res.values[0] } : null;
}

export async function saveHintLog(db, { gameId, fen, tier, detector = null, createdAt = new Date().toISOString() }) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  if (typeof fen !== 'string' || !fen) throw new TypeError('fen must be a non-empty string.');
  if (!['warm', 'warmer', 'hot'].includes(tier)) throw new RangeError(`Invalid tier: ${tier}`);
  return withTransaction(db, async (transactionDb) => {
    const res = await transactionDb.run(`
      INSERT INTO hint_logs (game_id, fen, tier, detector, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [gameId, fen, tier, detector, createdAt]);
    return Number(res.changes?.lastId);
  });
}

export async function getHintLogs(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  const res = await db.query('SELECT * FROM hint_logs WHERE game_id = ? ORDER BY id ASC', [gameId]);
  return (res.values || []).map((row) => ({ ...row }));
}

export async function getDailyStats(db, date) {
  assertDb(db);
  if (typeof date !== 'string' || !date) throw new TypeError('date must be a non-empty string (YYYY-MM-DD).');
  const res = await db.query('SELECT * FROM daily_stats WHERE date = ?', [date]);
  if (!res.values || res.values.length === 0) return null;
  const row = res.values[0];
  return {
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted),
  };
}

export async function getRecentDailyStats(db, { limitDays = 30 } = {}) {
  assertDb(db);
  const res = await db.query('SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?', [limitDays]);
  return (res.values || []).map((row) => ({
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted),
  }));
}

export async function recordDailySession(db, { date, targetGoal = 3, sessionScore = 0, isCountedStreakDay = 0 }) {
  assertDb(db);
  return withTransaction(db, async (transactionDb) => {
    const res = await transactionDb.query('SELECT * FROM daily_stats WHERE date = ?', [date]);
    const existing = res.values && res.values.length > 0 ? res.values[0] : null;
    if (!existing) {
      const completed = 1;
      const met = completed >= targetGoal ? 1 : 0;
      await transactionDb.run(`
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [date, completed, targetGoal, met, Number(sessionScore), isCountedStreakDay ? 1 : 0]);
    } else {
      const completed = Number(existing.sessions_completed) + 1;
      const met = completed >= Number(existing.goal_target) ? 1 : 0;
      const totalScore = Number(existing.total_score) + Number(sessionScore);
      const streakCounted = existing.streak_day_counted || isCountedStreakDay ? 1 : 0;
      await transactionDb.run(`
        UPDATE daily_stats
        SET sessions_completed = ?, goal_met = ?, total_score = ?, streak_day_counted = ?
        WHERE date = ?
      `, [completed, met, totalScore, streakCounted, date]);
    }
  });
}

export async function getStreakState(db) {
  assertDb(db);
  const res = await db.query('SELECT * FROM streak_state WHERE id = 1');
  if (!res.values || res.values.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezesRemaining: 2,
      freezesMonth: new Date().toISOString().slice(0, 7),
      lastCountedDate: null,
    };
  }
  const row = res.values[0];
  return {
    currentStreak: Number(row.current_streak),
    longestStreak: Number(row.longest_streak),
    freezesRemaining: Number(row.freezes_remaining),
    freezesMonth: row.freezes_month,
    lastCountedDate: row.last_counted_date,
  };
}

export async function updateStreakState(db, { currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate }) {
  assertDb(db);
  return withTransaction(db, async (transactionDb) => {
    await transactionDb.run(`
      INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        freezes_remaining = excluded.freezes_remaining,
        freezes_month = excluded.freezes_month,
        last_counted_date = excluded.last_counted_date
    `, [currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate]);
  });
}

export async function getCategoryMastery(db) {
  assertDb(db);
  const res = await db.query('SELECT * FROM category_mastery');
  const masteryMap = {};
  for (const cat of WEAKNESS_CATEGORIES) {
    masteryMap[cat] = {
      category: cat,
      masteryLevel: 0,
      lastPracticedAt: null,
      decayCheckedAt: null,
    };
  }
  for (const row of res.values || []) {
    masteryMap[row.category] = {
      category: row.category,
      masteryLevel: Number(row.mastery_level),
      lastPracticedAt: row.last_practiced_at,
      decayCheckedAt: row.decay_checked_at,
    };
  }
  return masteryMap;
}

export async function updateCategoryMastery(db, { category, masteryLevel, lastPracticedAt, decayCheckedAt }) {
  assertDb(db);
  if (!WEAKNESS_CATEGORIES.has(category)) throw new RangeError(`Unknown weakness category: ${category}`);
  return withTransaction(db, async (transactionDb) => {
    await transactionDb.run(`
      INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        mastery_level = excluded.mastery_level,
        last_practiced_at = excluded.last_practiced_at,
        decay_checked_at = excluded.decay_checked_at
    `, [category, Math.max(0, Math.min(5, Math.trunc(masteryLevel))), lastPracticedAt ?? null, decayCheckedAt ?? null]);
  });
}

async function clearAllUserData(db) {
  await db.execute('DELETE FROM hint_logs;');
  await db.execute('DELETE FROM seed_scores;');
  await db.execute('DELETE FROM weakness_tags;');
  await db.execute('DELETE FROM move_classifications;');
  await db.execute('DELETE FROM moves;');
  await db.execute('DELETE FROM games;');
  await db.execute('DELETE FROM settings;');
  await db.execute('DELETE FROM daily_stats;');
  await db.execute('DELETE FROM streak_state;');
  await db.execute('DELETE FROM category_mastery;');
}

export async function resetUserData(db) {
  assertDb(db);
  return withTransaction(db, async (transactionDb) => {
    await clearAllUserData(transactionDb);
  });
}

export async function exportDatabaseJson(db) {
  assertDb(db);
  const [
    settings, games, moves, weakness_tags, move_classifications,
    seed_scores, daily_stats, streak_state, category_mastery, hint_logs
  ] = await Promise.all([
    db.query('SELECT * FROM settings'),
    db.query('SELECT * FROM games'),
    db.query('SELECT * FROM moves'),
    db.query('SELECT * FROM weakness_tags'),
    db.query('SELECT * FROM move_classifications'),
    db.query('SELECT * FROM seed_scores'),
    db.query('SELECT * FROM daily_stats'),
    db.query('SELECT * FROM streak_state'),
    db.query('SELECT * FROM category_mastery'),
    db.query('SELECT * FROM hint_logs'),
  ]);

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables: {
      settings: settings.values || [],
      games: games.values || [],
      moves: moves.values || [],
      weakness_tags: weakness_tags.values || [],
      move_classifications: move_classifications.values || [],
      seed_scores: seed_scores.values || [],
      daily_stats: daily_stats.values || [],
      streak_state: streak_state.values || [],
      category_mastery: category_mastery.values || [],
      hint_logs: hint_logs.values || [],
    },
  };
}

export async function importDatabaseJson(db, payload) {
  assertDb(db);
  if (!payload || typeof payload !== 'object' || !payload.tables) {
    throw new TypeError('Invalid backup payload.');
  }

  return withTransaction(db, async (transactionDb) => {
    await clearAllUserData(transactionDb);
    const t = payload.tables;

    if (Array.isArray(t.settings)) {
      for (const r of t.settings) {
        await transactionDb.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [r.key, r.value]);
      }
    }
    if (Array.isArray(t.games)) {
      const stmt = `
        INSERT INTO games (
          id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
          import_source, external_game_id, player_color, white_player, black_player,
          analysis_engine, analysis_depth, assistance_level, hint_count, takeback_count, time_control, persona
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.games) {
        await transactionDb.run(stmt, [
          r.id, r.date, r.mode, r.status, r.result, r.seeded_weakness, r.seed_puzzle_id, r.start_fen, r.current_fen,
          r.import_source, r.external_game_id, r.player_color, r.white_player, r.black_player,
          r.analysis_engine, r.analysis_depth,
          r.assistance_level ?? 'none', r.hint_count ?? 0, r.takeback_count ?? 0, r.time_control ?? null, r.persona ?? null,
        ]);
      }
    }
    if (Array.isArray(t.moves)) {
      const stmt = `
        INSERT INTO moves (
          id, game_id, ply_number, fen_before, move_played, eval_cp_before, eval_cp_after,
          best_move, principal_variation, is_mate_score, stockfish_response, timestamp, timestamp_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.moves) {
        await transactionDb.run(stmt, [
          r.id, r.game_id, r.ply_number, r.fen_before, r.move_played, r.eval_cp_before, r.eval_cp_after,
          r.best_move, r.principal_variation, r.is_mate_score, r.stockfish_response, r.timestamp, r.timestamp_source ?? 'live_recorded',
        ]);
      }
    }
    if (Array.isArray(t.move_classifications)) {
      const stmt = `
        INSERT INTO move_classifications (
          id, move_id, status, category, severity, rationale, error, attempts,
          model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.move_classifications) {
        await transactionDb.run(stmt, [
          r.id, r.move_id, r.status, r.category, r.severity, r.rationale, r.error, r.attempts,
          r.model_used, r.backend, r.prompt_version, r.prompt_hash, r.analysis_timestamp, r.is_current,
        ]);
      }
    }
    if (Array.isArray(t.weakness_tags)) {
      const stmt = `
        INSERT INTO weakness_tags (id, move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.weakness_tags) {
        await transactionDb.run(stmt, [r.id, r.move_id, r.category, r.severity, r.source, r.classification_id]);
      }
    }
    if (Array.isArray(t.seed_scores)) {
      const stmt = `
        INSERT INTO seed_scores (id, game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.seed_scores) {
        await transactionDb.run(stmt, [r.id, r.game_id, r.accuracy_component, r.motif_component, r.hint_penalty, r.total_score, r.computed_at]);
      }
    }
    if (Array.isArray(t.daily_stats)) {
      const stmt = `
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.daily_stats) {
        await transactionDb.run(stmt, [r.date, r.sessions_completed, r.goal_target, r.goal_met, r.total_score, r.streak_day_counted]);
      }
    }
    if (Array.isArray(t.streak_state)) {
      const stmt = `
        INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.streak_state) {
        await transactionDb.run(stmt, [r.id, r.current_streak, r.longest_streak, r.freezes_remaining, r.freezes_month, r.last_counted_date]);
      }
    }
    if (Array.isArray(t.category_mastery)) {
      const stmt = `
        INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
        VALUES (?, ?, ?, ?)
      `;
      for (const r of t.category_mastery) {
        await transactionDb.run(stmt, [r.category, r.mastery_level, r.last_practiced_at, r.decay_checked_at]);
      }
    }
    if (Array.isArray(t.hint_logs)) {
      const stmt = `
        INSERT INTO hint_logs (id, game_id, fen, tier, detector, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.hint_logs) {
        await transactionDb.run(stmt, [r.id, r.game_id, r.fen, r.tier, r.detector, r.created_at]);
      }
    }
    return true;
  });
}
