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
  mode TEXT CHECK(mode IN ('practice','imported')),
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
  analysis_depth INTEGER NULL
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

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
`;

const ALLOWED_MODES = new Set(['practice', 'imported']);
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
  await db.execute('BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await db.execute('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.execute('ROLLBACK');
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
  
  return db;
}

export async function saveGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);

  const insertGameSql = `
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
      import_source, external_game_id, player_color, white_player, black_player,
      analysis_engine, analysis_depth
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const date = summary.date ?? summary.moves[0]?.timestamp ?? new Date().toISOString();

  return withTransaction(db, async () => {
    await db.run(insertGameSql, [
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
    ]);

    await insertMoves(db, summary);

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

  return withTransaction(db, async () => {
    const ids = [];
    for (const game of games) {
      await db.run(insertSql, [
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

  return withTransaction(db, async () => {
    const result = await db.run(`
      UPDATE games
      SET date = ?, mode = ?, status = 'completed', result = ?,
          seeded_weakness = ?, seed_puzzle_id = ?, start_fen = ?, current_fen = ?
      WHERE id = ? AND status = 'in_progress'
    `, [
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
      summary.id,
    ]);
    
    if (Number(result.changes?.changes) !== 1) {
      const res = await db.query('SELECT status FROM games WHERE id = ?', [summary.id]);
      const current = res.values && res.values.length > 0 ? res.values[0].status : null;
      throw new Error(`Cannot complete game ${summary.id} from status ${current ?? 'missing'}.`);
    }
    await insertMoves(db, summary);
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
           analysis_engine, analysis_depth
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
           analysis_engine, analysis_depth
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

  return withTransaction(db, async () => {
    const ids = [];
    for (const tag of normalizedTags) {
      if (typeof tag.category !== 'string' || !tag.category) throw new TypeError('tag.category must be a non-empty string.');
      if (typeof tag.severity !== 'string' || !tag.severity) throw new TypeError('tag.severity must be a non-empty string.');
      const source = tag.source ?? 'ai_classification';
      if (typeof source !== 'string' || !source) throw new TypeError('tag.source must be a non-empty string.');

      const result = await db.run(insertTagSql, [moveId, tag.category, tag.severity, source]);
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

  return withTransaction(db, async () => {
    const moveRes = await db.query('SELECT id FROM moves WHERE id = ?', [moveId]);
    if (!moveRes.values || moveRes.values.length === 0) throw new Error(`Move not found: ${moveId}`);
    
    await db.run('UPDATE move_classifications SET is_current = 0 WHERE move_id = ? AND is_current = 1', [moveId]);
    
    const inserted = await db.run(`
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
      await db.run(`
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

  let where = 'WHERE (wt.classification_id IS NULL OR mc.is_current = 1)';
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
    SELECT g.id, g.date, g.seeded_weakness, g.result, g.status, COUNT(m.id) AS move_count
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
  if (key === 'theme' && normalized !== 'cat') throw new RangeError('Only the cat theme is currently available.');
  if (key === 'cat_avatar' && !['orange-tabby', 'tuxedo', 'calico', 'black-cat'].includes(normalized)) {
    throw new RangeError('Unknown cat avatar.');
  }
  await db.run(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, normalized]);
  return normalized;
}

export async function resetUserData(db) {
  assertDb(db);
  return withTransaction(db, async () => {
    await db.execute('DELETE FROM weakness_tags;');
    await db.execute('DELETE FROM move_classifications;');
    await db.execute('DELETE FROM moves;');
    await db.execute('DELETE FROM games;');
    await db.execute('DELETE FROM settings;');
  });
}
