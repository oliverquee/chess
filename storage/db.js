import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
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
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a node:sqlite DatabaseSync handle.');
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

function withTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure; rollback errors are secondary.
    }
    throw error;
  }
}

function ensureMoveAnalysisColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(moves)').all().map((column) => column.name));
  const hadLegacyEval = columns.has('eval_cp');

  const additions = [
    ['eval_cp_before', 'INTEGER NULL'],
    ['eval_cp_after', 'INTEGER NULL'],
    ['best_move', 'TEXT NULL'],
    ['best_move_depth8', 'TEXT NULL'],
    ['principal_variation', 'TEXT NULL'],
    ['is_mate_score', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1))'],
    ['time_to_move_ms', 'INTEGER NULL'],
    ['clock_remaining_ms', 'INTEGER NULL'],
  ];

  for (const [name, sqlType] of additions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE moves ADD COLUMN ${name} ${sqlType}`);
      columns.add(name);
    }
  }

  // Preserve the only interpretation available for pre-migration rows. Old
  // eval_cp was the pre-move evaluation; no trustworthy post-move value can be
  // reconstructed without re-analysis, so eval_cp_after remains NULL.
  if (hadLegacyEval) {
    db.exec('UPDATE moves SET eval_cp_before = eval_cp WHERE eval_cp_before IS NULL AND eval_cp IS NOT NULL');
  }
}

function ensureGameStatusColumn(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(games)').all().map((column) => column.name));
  if (!columns.has('status')) {
    db.exec(`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
      CHECK(status IN ('queued','in_progress','completed','analyzed'))`);
  }
}

function ensureImportColumns(db) {
  const gameColumns = new Set(db.prepare('PRAGMA table_info(games)').all().map((column) => column.name));
  const gameAdditions = [
    ['import_source', 'TEXT NULL'],
    ['external_game_id', 'TEXT NULL'],
    ['player_color', "TEXT NULL CHECK(player_color IN ('white','black'))"],
    ['white_player', 'TEXT NULL'],
    ['black_player', 'TEXT NULL'],
    ['analysis_engine', 'TEXT NULL'],
    ['analysis_depth', 'INTEGER NULL'],
    ['assistance_level', "TEXT NULL CHECK(assistance_level IN ('none','preview','hints','full'))"],
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) db.exec(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }

  const moveColumns = new Set(db.prepare('PRAGMA table_info(moves)').all().map((column) => column.name));
  if (!moveColumns.has('timestamp_source')) {
    db.exec(`ALTER TABLE moves ADD COLUMN timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
      CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_games_import_identity
    ON games(import_source, external_game_id)
    WHERE import_source IS NOT NULL AND external_game_id IS NOT NULL`);
}

function ensureWeaknessClassificationColumn(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(weakness_tags)').all().map((column) => column.name));
  if (!columns.has('classification_id')) {
    db.exec('ALTER TABLE weakness_tags ADD COLUMN classification_id INTEGER NULL REFERENCES move_classifications(id)');
  }
}

function ensureM10ColumnsAndTables(db) {
  const gameColumns = new Set(db.prepare('PRAGMA table_info(games)').all().map((column) => column.name));
  const gameAdditions = [
    ['assistance_level', "TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full'))"],
    ['hint_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['takeback_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['time_control', 'TEXT NULL'],
    ['persona', 'TEXT NULL'],
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) db.exec(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }

  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
    CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_results_detector ON analysis_results(detector);
  `);
}

function prepareMoveInsert(db) {
  return db.prepare(`
    INSERT INTO moves (
      game_id,
      ply_number,
      fen_before,
      move_played,
      eval_cp_before,
      eval_cp_after,
      best_move,
      best_move_depth8,
      principal_variation,
      is_mate_score,
      stockfish_response,
      time_to_move_ms,
      clock_remaining_ms,
      timestamp,
      timestamp_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

function insertMoves(insertMove, summary) {
  for (const [index, move] of summary.moves.entries()) {
    validateMove(move, summary.id);
    if (move.ply_number !== index + 1) {
      throw new Error(`Expected ply_number ${index + 1}, received ${move.ply_number}.`);
    }
    insertMove.run(
      summary.id,
      move.ply_number,
      move.fen_before,
      move.move_played,
      normalizeNullableInteger(move.eval_cp_before, 'move.eval_cp_before'),
      normalizeNullableInteger(move.eval_cp_after, 'move.eval_cp_after'),
      normalizeNullableText(move.best_move, 'move.best_move'),
      normalizeNullableText(move.best_move_depth8, 'move.best_move_depth8'),
      normalizeNullableText(move.principal_variation, 'move.principal_variation'),
      normalizeMateFlag(move.is_mate_score),
      move.stockfish_response ?? null,
      normalizeNullableInteger(move.time_to_move_ms, 'move.time_to_move_ms'),
      normalizeNullableInteger(move.clock_remaining_ms, 'move.clock_remaining_ms'),
      move.timestamp,
      timestampSourceFor(move, summary.mode),
    );
  }
}

export function initDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');

  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 10000;');
  }
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  ensureGameStatusColumn(db);
  ensureMoveAnalysisColumns(db);
  ensureWeaknessClassificationColumn(db);
  ensureImportColumns(db);
  ensureM10ColumnsAndTables(db);
  return db;
}

export function saveGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);

  const insertGame = db.prepare(`
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
      import_source, external_game_id, player_color, white_player, black_player,
      analysis_engine, analysis_depth,
      assistance_level, hint_count, takeback_count, time_control, persona
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMove = prepareMoveInsert(db);

  const date = summary.date ?? summary.moves[0]?.timestamp ?? new Date().toISOString();
  const status = summary.status ?? 'completed';
  const assistanceLevel = summary.assistance_level ?? (summary.mode === 'imported' ? 'none' : 'none');

  return withTransaction(db, () => {
    insertGame.run(
      summary.id,
      date,
      summary.mode,
      status,
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
      summary.assistance_level ?? assistanceLevel,
      summary.hint_count ?? 0,
      summary.takeback_count ?? 0,
      summary.time_control ?? null,
      summary.persona ?? null,
    );

    insertMoves(insertMove, summary);

    return summary.id;
  });
}

export function updateMoveAnalysis(db, moveId, {
  eval_cp_before,
  eval_cp_after,
  best_move,
  best_move_depth8,
  principal_variation,
  is_mate_score,
}) {
  assertDb(db);
  const stmt = db.prepare(`
    UPDATE moves
    SET eval_cp_before = ?,
        eval_cp_after = ?,
        best_move = ?,
        best_move_depth8 = ?,
        principal_variation = ?,
        is_mate_score = ?
    WHERE id = ?
  `);
  stmt.run(
    normalizeNullableInteger(eval_cp_before, 'eval_cp_before'),
    normalizeNullableInteger(eval_cp_after, 'eval_cp_after'),
    normalizeNullableText(best_move, 'best_move'),
    normalizeNullableText(best_move_depth8, 'best_move_depth8'),
    normalizeNullableText(principal_variation, 'principal_variation'),
    normalizeMateFlag(is_mate_score),
    moveId,
  );
}

export function updateGameAnalysisStatus(db, gameId, { status = 'analyzed', analysis_engine = 'Stockfish', analysis_depth = 16 } = {}) {
  assertDb(db);
  const stmt = db.prepare(`
    UPDATE games
    SET status = ?, analysis_engine = ?, analysis_depth = ?
    WHERE id = ?
  `);
  stmt.run(status, analysis_engine, analysis_depth, gameId);
}

function validateQueuedGame(game) {
  if (!game || typeof game !== 'object') throw new TypeError('game must be an object.');
  if (typeof game.id !== 'string' || !game.id) throw new TypeError('game.id must be a non-empty string.');
  if (typeof game.start_fen !== 'string' || !game.start_fen) throw new TypeError('game.start_fen must be a non-empty string.');
}

export function createQueuedGames(db, games) {
  assertDb(db);
  if (!Array.isArray(games) || games.length === 0) {
    throw new TypeError('games must be a non-empty array.');
  }
  games.forEach(validateQueuedGame);
  const insert = db.prepare(`
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen
    ) VALUES (?, ?, 'practice', 'queued', NULL, ?, ?, ?, ?)
  `);

  return withTransaction(db, () => games.map((game) => {
    insert.run(
      game.id,
      game.date ?? new Date().toISOString(),
      game.seeded_weakness ?? null,
      game.seed_puzzle_id ?? null,
      game.start_fen,
      game.start_fen,
    );
    return game.id;
  }));
}

export function createQueuedGame(db, game) {
  return createQueuedGames(db, [game])[0];
}

export function getGameStatus(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  const row = db.prepare('SELECT status FROM games WHERE id = ?').get(gameId);
  if (!row) throw new Error(`Game not found: ${gameId}`);
  return row.status;
}

export function transitionGameStatus(db, gameId, nextStatus) {
  const current = getGameStatus(db, gameId);
  const expected = SESSION_TRANSITIONS[current];
  if (nextStatus !== expected) {
    throw new Error(`Invalid game status transition: ${current} → ${nextStatus}. Expected ${expected ?? 'no further transition'}.`);
  }
  const result = db.prepare('UPDATE games SET status = ? WHERE id = ? AND status = ?')
    .run(nextStatus, gameId, current);
  if (Number(result.changes) !== 1) throw new Error(`Game status changed concurrently: ${gameId}`);
  return nextStatus;
}

export function completeGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);
  const insertMove = prepareMoveInsert(db);
  const date = summary.moves[0]?.timestamp ?? new Date().toISOString();

  return withTransaction(db, () => {
    const result = db.prepare(`
      UPDATE games
      SET date = ?, mode = ?, status = 'completed', result = ?,
          seeded_weakness = ?, seed_puzzle_id = ?, start_fen = ?, current_fen = ?,
          assistance_level = ?, hint_count = ?, takeback_count = ?, time_control = ?, persona = ?
      WHERE id = ? AND status = 'in_progress'
    `).run(
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
    );
    if (Number(result.changes) !== 1) {
      const current = db.prepare('SELECT status FROM games WHERE id = ?').get(summary.id)?.status;
      throw new Error(`Cannot complete game ${summary.id} from status ${current ?? 'missing'}.`);
    }
    insertMoves(insertMove, summary);
    return summary.id;
  });
}

export function getGameHistory(db, { limit, weaknessCategory } = {}) {
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

  const games = db.prepare(sql).all(...params);
  const movesForGame = db.prepare(`
    SELECT
      id,
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
    FROM moves
    WHERE game_id = ?
    ORDER BY ply_number ASC, id ASC
  `);

  return games.map((game) => ({
    ...game,
    moves: movesForGame.all(game.id).map((move) => ({ ...move })),
  }));
}

export function getGameById(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  const game = db.prepare(`
    SELECT id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
           import_source, external_game_id, player_color, white_player, black_player,
           analysis_engine, analysis_depth,
           assistance_level, hint_count, takeback_count, time_control, persona
    FROM games WHERE id = ?
  `).get(gameId);
  if (!game) throw new Error(`Game not found: ${gameId}`);
  const moves = db.prepare(`
    SELECT id, game_id, ply_number, fen_before, move_played, eval_cp_before,
           eval_cp_after, best_move, principal_variation, is_mate_score,
           stockfish_response, timestamp, timestamp_source
    FROM moves WHERE game_id = ? ORDER BY ply_number ASC, id ASC
  `).all(gameId);
  return { ...game, moves: moves.map((move) => ({ ...move })) };
}

// Future /analysis code will call this after per-move AI classification.
// Storage deliberately accepts only the structured tag rows; it does not call an LLM itself.
export function saveWeaknessTags(db, moveId, tags) {
  assertDb(db);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError('moveId must be a positive integer.');

  const normalizedTags = Array.isArray(tags) ? tags : [tags];
  if (normalizedTags.length === 0 || normalizedTags.some((tag) => !tag || typeof tag !== 'object')) {
    throw new TypeError('tags must contain one or more tag objects.');
  }

  const insertTag = db.prepare(`
    INSERT INTO weakness_tags (move_id, category, severity, source)
    VALUES (?, ?, ?, ?)
  `);

  return withTransaction(db, () => normalizedTags.map((tag) => {
    if (typeof tag.category !== 'string' || !tag.category) throw new TypeError('tag.category must be a non-empty string.');
    if (typeof tag.severity !== 'string' || !tag.severity) throw new TypeError('tag.severity must be a non-empty string.');
    const source = tag.source ?? 'ai_classification';
    if (typeof source !== 'string' || !source) throw new TypeError('tag.source must be a non-empty string.');

    const result = insertTag.run(moveId, tag.category, tag.severity, source);
    return Number(result.lastInsertRowid);
  }));
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

export function saveMoveClassification(db, moveId, result) {
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

  return withTransaction(db, () => {
    const move = db.prepare('SELECT id FROM moves WHERE id = ?').get(moveId);
    if (!move) throw new Error(`Move not found: ${moveId}`);
    db.prepare('UPDATE move_classifications SET is_current = 0 WHERE move_id = ? AND is_current = 1').run(moveId);
    const inserted = db.prepare(`
      INSERT INTO move_classifications (
        move_id, status, category, severity, rationale, error, attempts,
        model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
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
    );
    const classificationId = Number(inserted.lastInsertRowid);
    if (result.status === 'classified') {
      db.prepare(`
        INSERT INTO weakness_tags (move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, 'ai_classification', ?)
      `).run(moveId, value.category, value.severity, classificationId);
    }
    return classificationId;
  });
}

export function getMoveClassifications(db, moveId, { currentOnly = false } = {}) {
  assertDb(db);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError('moveId must be a positive integer.');
  return db.prepare(`
    SELECT id, move_id, status, category, severity, rationale, error, attempts,
           model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
    FROM move_classifications
    WHERE move_id = ? ${currentOnly ? 'AND is_current = 1' : ''}
    ORDER BY id ASC
  `).all(moveId).map((row) => ({ ...row }));
}

export function getWeaknessTally(db, { sinceGameId } = {}) {
  assertDb(db);

  let where = "WHERE (wt.classification_id IS NULL OR mc.is_current = 1) AND g.assistance_level = 'none'";
  let params = [];

  if (sinceGameId !== undefined) {
    if (typeof sinceGameId !== 'string' || !sinceGameId) {
      throw new TypeError('sinceGameId must be a non-empty string when provided.');
    }

    const anchor = db.prepare('SELECT date, rowid AS insertion_order FROM games WHERE id = ?').get(sinceGameId);
    if (!anchor) throw new Error(`Game not found: ${sinceGameId}`);

    if (anchor.date === null) {
      where += ' AND g.rowid >= ?';
      params = [anchor.insertion_order];
    } else {
      where += ' AND (g.date > ? OR (g.date = ? AND g.rowid >= ?))';
      params = [anchor.date, anchor.date, anchor.insertion_order];
    }
  }

  const rows = db.prepare(`
    SELECT wt.category AS category, COUNT(*) AS count
    FROM weakness_tags wt
    JOIN moves m ON m.id = wt.move_id
    JOIN games g ON g.id = m.game_id
    LEFT JOIN move_classifications mc ON mc.id = wt.classification_id
    ${where}
    GROUP BY wt.category
    ORDER BY count DESC, wt.category ASC
  `).all(...params);

  return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
}

export function saveSeedScore(db, { gameId, accuracyComponent, motifComponent, hintPenalty, totalScore, computedAt = new Date().toISOString() }) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  return withTransaction(db, () => {
    const res = db.prepare(`
      INSERT INTO seed_scores (game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(gameId, Number(accuracyComponent), Number(motifComponent), Number(hintPenalty), Number(totalScore), computedAt);
    return Number(res.lastInsertRowid);
  });
}

export function getSeedScore(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  const row = db.prepare('SELECT * FROM seed_scores WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gameId);
  return row ? { ...row } : null;
}

export function saveHintLog(db, { gameId, fen, tier, detector = null, createdAt = new Date().toISOString() }) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  if (typeof fen !== 'string' || !fen) throw new TypeError('fen must be a non-empty string.');
  if (!['warm', 'warmer', 'hot'].includes(tier)) throw new RangeError(`Invalid tier: ${tier}`);
  return withTransaction(db, () => {
    const res = db.prepare(`
      INSERT INTO hint_logs (game_id, fen, tier, detector, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(gameId, fen, tier, detector, createdAt);
    return Number(res.lastInsertRowid);
  });
}

export function getHintLogs(db, gameId) {
  assertDb(db);
  if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId must be a non-empty string.');
  return db.prepare('SELECT * FROM hint_logs WHERE game_id = ? ORDER BY id ASC').all(gameId).map((row) => ({ ...row }));
}

export function getDailyStats(db, date) {
  assertDb(db);
  if (typeof date !== 'string' || !date) throw new TypeError('date must be a non-empty string (YYYY-MM-DD).');
  const row = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(date);
  if (!row) return null;
  return {
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted),
  };
}

export function getRecentDailyStats(db, { limitDays = 30 } = {}) {
  assertDb(db);
  const rows = db.prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?').all(limitDays);
  return rows.map((row) => ({
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted),
  }));
}

export function recordDailySession(db, { date, targetGoal = 3, sessionScore = 0, isCountedStreakDay = 0 }) {
  assertDb(db);
  return withTransaction(db, () => {
    const existing = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(date);
    if (!existing) {
      const completed = 1;
      const met = completed >= targetGoal ? 1 : 0;
      db.prepare(`
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(date, completed, targetGoal, met, Number(sessionScore), isCountedStreakDay ? 1 : 0);
    } else {
      const completed = Number(existing.sessions_completed) + 1;
      const met = completed >= Number(existing.goal_target) ? 1 : 0;
      const totalScore = Number(existing.total_score) + Number(sessionScore);
      const streakCounted = existing.streak_day_counted || isCountedStreakDay ? 1 : 0;
      db.prepare(`
        UPDATE daily_stats
        SET sessions_completed = ?, goal_met = ?, total_score = ?, streak_day_counted = ?
        WHERE date = ?
      `).run(completed, met, totalScore, streakCounted, date);
    }
  });
}

export function getStreakState(db) {
  assertDb(db);
  const row = db.prepare('SELECT * FROM streak_state WHERE id = 1').get();
  if (!row) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezesRemaining: 2,
      freezesMonth: new Date().toISOString().slice(0, 7),
      lastCountedDate: null,
    };
  }
  return {
    currentStreak: Number(row.current_streak),
    longestStreak: Number(row.longest_streak),
    freezesRemaining: Number(row.freezes_remaining),
    freezesMonth: row.freezes_month,
    lastCountedDate: row.last_counted_date,
  };
}

export function updateStreakState(db, { currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate }) {
  assertDb(db);
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        freezes_remaining = excluded.freezes_remaining,
        freezes_month = excluded.freezes_month,
        last_counted_date = excluded.last_counted_date
    `).run(currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate);
  });
}

export function getCategoryMastery(db) {
  assertDb(db);
  const rows = db.prepare('SELECT * FROM category_mastery').all();
  const masteryMap = {};
  for (const cat of WEAKNESS_CATEGORIES) {
    masteryMap[cat] = {
      category: cat,
      masteryLevel: 0,
      lastPracticedAt: null,
      decayCheckedAt: null,
    };
  }
  for (const row of rows) {
    masteryMap[row.category] = {
      category: row.category,
      masteryLevel: Number(row.mastery_level),
      lastPracticedAt: row.last_practiced_at,
      decayCheckedAt: row.decay_checked_at,
    };
  }
  return masteryMap;
}

export function updateCategoryMastery(db, { category, masteryLevel, lastPracticedAt, decayCheckedAt }) {
  assertDb(db);
  if (!WEAKNESS_CATEGORIES.has(category)) throw new RangeError(`Unknown weakness category: ${category}`);
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        mastery_level = excluded.mastery_level,
        last_practiced_at = excluded.last_practiced_at,
        decay_checked_at = excluded.decay_checked_at
    `).run(category, Math.max(0, Math.min(5, Math.trunc(masteryLevel))), lastPracticedAt ?? null, decayCheckedAt ?? null);
  });
}

export function getSettings(db) {
  assertDb(db);
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (SETTING_KEYS.has(row.key)) settings[row.key] = String(row.value);
  }
  return settings;
}

export function setSetting(db, key, value) {
  assertDb(db);
  if (!SETTING_KEYS.has(key)) throw new RangeError(`Unknown setting: ${key}`);
  const normalized = String(value ?? '').trim();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, normalized);
  return normalized;
}

export function getProfileStats(db, { recentLimit = 10 } = {}) {
  assertDb(db);
  if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
    throw new RangeError('recentLimit must be an integer from 1 to 50.');
  }

  const totals = db.prepare(`
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
  `).get() ?? { total_sessions: 0, total_moves: 0 };

  const recent = db.prepare(`
    SELECT g.id, g.date, g.seeded_weakness, g.result, g.status, g.assistance_level, g.persona, COUNT(m.id) AS move_count
    FROM games g
    LEFT JOIN moves m ON m.game_id = g.id
    WHERE g.status IN ('completed', 'analyzed')
    GROUP BY g.id
    ORDER BY COALESCE(g.date, '') DESC, g.rowid DESC
    LIMIT ?
  `).all(recentLimit);

  return {
    totalSessions: Number(totals.total_sessions ?? 0),
    totalMoves: Number(totals.total_moves ?? 0),
    weaknessTally: getWeaknessTally(db),
    recentSessions: recent.map((row) => ({
      ...row,
      move_count: Number(row.move_count ?? 0),
    })),
  };
}

function clearAllUserData(db) {
  db.exec(`
    DELETE FROM hint_logs;
    DELETE FROM seed_scores;
    DELETE FROM weakness_tags;
    DELETE FROM move_classifications;
    DELETE FROM moves;
    DELETE FROM games;
    DELETE FROM settings;
    DELETE FROM daily_stats;
    DELETE FROM streak_state;
    DELETE FROM category_mastery;
    DELETE FROM analysis_results;
  `);
}

export function resetUserData(db) {
  assertDb(db);
  return withTransaction(db, () => {
    clearAllUserData(db);
  });
}

export function saveAnalysisResult(db, {
  run_at = new Date().toISOString(),
  detector,
  result,
  games_analyzed,
  moves_analyzed,
}) {
  assertDb(db);
  if (typeof detector !== 'string' || !detector.trim()) throw new TypeError('detector must be a non-empty string.');
  if (result === undefined) throw new TypeError('result is required.');
  const resultJson = typeof result === 'string' ? result : JSON.stringify(result);
  const stmt = db.prepare(`
    INSERT INTO analysis_results (run_at, detector, result_json, games_analyzed, moves_analyzed)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    run_at,
    detector,
    resultJson,
    normalizeNullableInteger(games_analyzed, 'games_analyzed') ?? 0,
    normalizeNullableInteger(moves_analyzed, 'moves_analyzed') ?? 0,
  );
}

export function getLatestAnalysisResults(db) {
  assertDb(db);
  const rows = db.prepare(`
    SELECT r1.*
    FROM analysis_results r1
    JOIN (
      SELECT detector, MAX(id) AS max_id
      FROM analysis_results
      GROUP BY detector
    ) r2 ON r1.id = r2.max_id
    ORDER BY r1.id DESC
  `).all();
  const results = {};
  for (const row of rows) {
    results[row.detector] = {
      id: row.id,
      run_at: row.run_at,
      detector: row.detector,
      result: JSON.parse(row.result_json),
      games_analyzed: row.games_analyzed,
      moves_analyzed: row.moves_analyzed,
    };
  }
  return results;
}

export function getAnalysisHistory(db, detector) {
  assertDb(db);
  const stmt = detector
    ? db.prepare('SELECT * FROM analysis_results WHERE detector = ? ORDER BY id DESC')
    : db.prepare('SELECT * FROM analysis_results ORDER BY id DESC');
  const rows = detector ? stmt.all(detector) : stmt.all();
  return rows.map((r) => ({
    id: r.id,
    run_at: r.run_at,
    detector: r.detector,
    result: JSON.parse(r.result_json),
    games_analyzed: r.games_analyzed,
    moves_analyzed: r.moves_analyzed,
  }));
}

export function exportDatabaseJson(db) {
  assertDb(db);
  const tables = {
    settings: db.prepare('SELECT * FROM settings').all(),
    games: db.prepare('SELECT * FROM games').all(),
    moves: db.prepare('SELECT * FROM moves').all(),
    weakness_tags: db.prepare('SELECT * FROM weakness_tags').all(),
    move_classifications: db.prepare('SELECT * FROM move_classifications').all(),
    seed_scores: db.prepare('SELECT * FROM seed_scores').all(),
    daily_stats: db.prepare('SELECT * FROM daily_stats').all(),
    streak_state: db.prepare('SELECT * FROM streak_state').all(),
    category_mastery: db.prepare('SELECT * FROM category_mastery').all(),
    hint_logs: db.prepare('SELECT * FROM hint_logs').all(),
    analysis_results: db.prepare('SELECT * FROM analysis_results').all(),
  };
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

export function importDatabaseJson(db, payload) {
  assertDb(db);
  if (!payload || typeof payload !== 'object' || !payload.tables) {
    throw new TypeError('Invalid backup payload.');
  }

  return withTransaction(db, () => {
    clearAllUserData(db);
    const t = payload.tables;

    if (Array.isArray(t.settings)) {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const r of t.settings) stmt.run(r.key, r.value);
    }
    if (Array.isArray(t.games)) {
      const stmt = db.prepare(`
        INSERT INTO games (
          id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
          import_source, external_game_id, player_color, white_player, black_player,
          analysis_engine, analysis_depth, assistance_level, hint_count, takeback_count, time_control, persona
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.games) {
        stmt.run(
          r.id, r.date, r.mode, r.status, r.result, r.seeded_weakness, r.seed_puzzle_id, r.start_fen, r.current_fen,
          r.import_source, r.external_game_id, r.player_color, r.white_player, r.black_player,
          r.analysis_engine, r.analysis_depth,
          r.assistance_level ?? 'none', r.hint_count ?? 0, r.takeback_count ?? 0, r.time_control ?? null, r.persona ?? null,
        );
      }
    }
    if (Array.isArray(t.moves)) {
      const stmt = db.prepare(`
        INSERT INTO moves (
          id, game_id, ply_number, fen_before, move_played, eval_cp_before, eval_cp_after,
          best_move, principal_variation, is_mate_score, stockfish_response, timestamp, timestamp_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.moves) {
        stmt.run(
          r.id, r.game_id, r.ply_number, r.fen_before, r.move_played, r.eval_cp_before, r.eval_cp_after,
          r.best_move, r.principal_variation, r.is_mate_score, r.stockfish_response, r.timestamp, r.timestamp_source ?? 'live_recorded',
        );
      }
    }
    if (Array.isArray(t.move_classifications)) {
      const stmt = db.prepare(`
        INSERT INTO move_classifications (
          id, move_id, status, category, severity, rationale, error, attempts,
          model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.move_classifications) {
        stmt.run(
          r.id, r.move_id, r.status, r.category, r.severity, r.rationale, r.error, r.attempts,
          r.model_used, r.backend, r.prompt_version, r.prompt_hash, r.analysis_timestamp, r.is_current,
        );
      }
    }
    if (Array.isArray(t.weakness_tags)) {
      const stmt = db.prepare(`
        INSERT INTO weakness_tags (id, move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.weakness_tags) {
        stmt.run(r.id, r.move_id, r.category, r.severity, r.source, r.classification_id);
      }
    }
    if (Array.isArray(t.seed_scores)) {
      const stmt = db.prepare(`
        INSERT INTO seed_scores (id, game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.seed_scores) {
        stmt.run(r.id, r.game_id, r.accuracy_component, r.motif_component, r.hint_penalty, r.total_score, r.computed_at);
      }
    }
    if (Array.isArray(t.daily_stats)) {
      const stmt = db.prepare(`
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.daily_stats) {
        stmt.run(r.date, r.sessions_completed, r.goal_target, r.goal_met, r.total_score, r.streak_day_counted);
      }
    }
    if (Array.isArray(t.streak_state)) {
      const stmt = db.prepare(`
        INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.streak_state) {
        stmt.run(r.id, r.current_streak, r.longest_streak, r.freezes_remaining, r.freezes_month, r.last_counted_date);
      }
    }
    if (Array.isArray(t.category_mastery)) {
      const stmt = db.prepare(`
        INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const r of t.category_mastery) {
        stmt.run(r.category, r.mastery_level, r.last_practiced_at, r.decay_checked_at);
      }
    }
    if (Array.isArray(t.hint_logs)) {
      const stmt = db.prepare(`
        INSERT INTO hint_logs (id, game_id, fen, tier, detector, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.hint_logs) {
        stmt.run(r.id, r.game_id, r.fen, r.tier, r.detector, r.created_at);
      }
    }
    if (Array.isArray(t.analysis_results)) {
      const stmt = db.prepare(`
        INSERT INTO analysis_results (id, run_at, detector, result_json, games_analyzed, moves_analyzed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of t.analysis_results) {
        stmt.run(r.id, r.run_at, r.detector, r.result_json, r.games_analyzed, r.moves_analyzed);
      }
    }
    return true;
  });
}


