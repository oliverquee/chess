import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
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
    ['principal_variation', 'TEXT NULL'],
    ['is_mate_score', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1))'],
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
      principal_variation,
      is_mate_score,
      stockfish_response,
      timestamp,
      timestamp_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      normalizeNullableText(move.principal_variation, 'move.principal_variation'),
      normalizeMateFlag(move.is_mate_score),
      move.stockfish_response ?? null,
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
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  ensureGameStatusColumn(db);
  ensureMoveAnalysisColumns(db);
  ensureWeaknessClassificationColumn(db);
  ensureImportColumns(db);
  return db;
}

export function saveGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);

  const insertGame = db.prepare(`
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
      import_source, external_game_id, player_color, white_player, black_player,
      analysis_engine, analysis_depth
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMove = prepareMoveInsert(db);

  const date = summary.date ?? summary.moves[0]?.timestamp ?? new Date().toISOString();

  return withTransaction(db, () => {
    insertGame.run(
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
    );

    insertMoves(insertMove, summary);

    return summary.id;
  });
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
          seeded_weakness = ?, seed_puzzle_id = ?, start_fen = ?, current_fen = ?
      WHERE id = ? AND status = 'in_progress'
    `).run(
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
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
           analysis_engine, analysis_depth
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
           analysis_engine, analysis_depth
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

  let where = 'WHERE (wt.classification_id IS NULL OR mc.is_current = 1)';
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
