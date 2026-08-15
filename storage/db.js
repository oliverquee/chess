import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
const ALLOWED_MODES = new Set(['practice', 'imported']);

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
  if (move.stockfish_response !== null && move.stockfish_response !== undefined && typeof move.stockfish_response !== 'string') {
    throw new TypeError('move.stockfish_response must be a string or null.');
  }
  normalizeNullableInteger(move.eval_cp, 'move.eval_cp');
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

export function initDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');

  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

export function saveGameSession(db, summary) {
  assertDb(db);
  validateSessionHeader(summary);

  const insertGame = db.prepare(`
    INSERT INTO games (
      id, date, mode, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMove = db.prepare(`
    INSERT INTO moves (
      game_id, ply_number, fen_before, move_played, eval_cp, stockfish_response, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const date = summary.moves[0]?.timestamp ?? new Date().toISOString();

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
    );

    for (const move of summary.moves) {
      validateMove(move, summary.id);
      insertMove.run(
        summary.id,
        move.ply_number,
        move.fen_before,
        move.move_played,
        normalizeNullableInteger(move.eval_cp, 'move.eval_cp'),
        move.stockfish_response ?? null,
        move.timestamp,
      );
    }

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
    SELECT id, date, mode, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen
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
    SELECT id, game_id, ply_number, fen_before, move_played, eval_cp, stockfish_response, timestamp
    FROM moves
    WHERE game_id = ?
    ORDER BY ply_number ASC, id ASC
  `);

  return games.map((game) => ({
    ...game,
    moves: movesForGame.all(game.id).map((move) => ({ ...move })),
  }));
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

export function getWeaknessTally(db, { sinceGameId } = {}) {
  assertDb(db);

  let where = '';
  let params = [];

  if (sinceGameId !== undefined) {
    if (typeof sinceGameId !== 'string' || !sinceGameId) {
      throw new TypeError('sinceGameId must be a non-empty string when provided.');
    }

    const anchor = db.prepare('SELECT date, rowid AS insertion_order FROM games WHERE id = ?').get(sinceGameId);
    if (!anchor) throw new Error(`Game not found: ${sinceGameId}`);

    if (anchor.date === null) {
      where = 'WHERE g.rowid >= ?';
      params = [anchor.insertion_order];
    } else {
      where = 'WHERE (g.date > ? OR (g.date = ? AND g.rowid >= ?))';
      params = [anchor.date, anchor.date, anchor.insertion_order];
    }
  }

  const rows = db.prepare(`
    SELECT wt.category AS category, COUNT(*) AS count
    FROM weakness_tags wt
    JOIN moves m ON m.id = wt.move_id
    JOIN games g ON g.id = m.game_id
    ${where}
    GROUP BY wt.category
    ORDER BY count DESC, wt.category ASC
  `).all(...params);

  return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
}
