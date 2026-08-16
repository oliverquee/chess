import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PUZZLE_SCHEMA_PATH = fileURLToPath(new URL('./puzzleSchema.sql', import.meta.url));

function assertDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a node:sqlite DatabaseSync handle.');
  }
}

function normalizeThemeTags(themeTags = []) {
  return [...new Set(themeTags.filter((theme) => typeof theme === 'string' && theme))];
}

function normalizeStepRange(stepRange = [0, Number.POSITIVE_INFINITY]) {
  if (!Array.isArray(stepRange) || stepRange.length !== 2) {
    throw new TypeError('stepRange must be [min, max].');
  }
  const [min, max] = stepRange;
  if (!Number.isFinite(min) || min < 0) throw new RangeError('stepRange minimum must be a non-negative finite number.');
  if (!(Number.isFinite(max) || max === Number.POSITIVE_INFINITY) || max < min) {
    throw new RangeError('stepRange maximum must be >= minimum.');
  }
  return [Math.trunc(min), max === Number.POSITIVE_INFINITY ? max : Math.trunc(max)];
}

function buildFilter(themeTags, stepRange) {
  const themes = normalizeThemeTags(themeTags);
  const [minSteps, maxSteps] = normalizeStepRange(stepRange);
  const clauses = ['p.step_count >= ?'];
  const params = [minSteps];

  if (maxSteps !== Number.POSITIVE_INFINITY) {
    clauses.push('p.step_count <= ?');
    params.push(maxSteps);
  }

  if (themes.length) {
    const placeholders = themes.map(() => '?').join(', ');
    clauses.push(`p.puzzle_id IN (SELECT puzzle_id FROM puzzle_themes WHERE theme IN (${placeholders}))`);
    params.push(...themes);
  }

  return { whereSql: clauses.join(' AND '), params };
}

function rowToPuzzle(row, themes) {
  const moves = row.moves.trim().split(/\s+/).filter(Boolean);
  return Object.freeze({
    PuzzleId: row.puzzle_id,
    FEN: row.fen,
    Moves: row.moves,
    Themes: themes.join(' '),
    Rating: row.rating,
    moves,
    themes: Object.freeze([...themes]),
    stepCount: row.step_count,
  });
}

export function initPuzzleDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec(readFileSync(PUZZLE_SCHEMA_PATH, 'utf8'));
  return db;
}

export function openPuzzleDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');
  return new DatabaseSync(path, { readOnly: true });
}

export class SqlitePuzzleLibrary {
  constructor(db) {
    assertDb(db);
    this.db = db;
    this.themesForPuzzle = db.prepare(`
      SELECT theme
      FROM puzzle_themes
      WHERE puzzle_id = ?
      ORDER BY theme ASC
    `);
  }

  hydrate(row) {
    if (!row) return null;
    const themes = this.themesForPuzzle.all(row.puzzle_id).map((item) => item.theme);
    return rowToPuzzle(row, themes);
  }

  filter({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY], limit = 1000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
      throw new RangeError('limit must be an integer from 1 to 10000 for SQLite puzzle queries.');
    }

    const { whereSql, params } = buildFilter(themeTags, stepRange);
    const rows = this.db.prepare(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT ?
    `).all(...params, limit);

    return rows.map((row) => this.hydrate(row));
  }

  sample({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY] } = {}, random = Math.random) {
    const { whereSql, params } = buildFilter(themeTags, stepRange);
    const countRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM puzzles p
      WHERE ${whereSql}
    `).get(...params);
    const count = Number(countRow.count);
    if (count === 0) return null;

    const randomValue = Number(random());
    const bounded = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999999, randomValue)) : 0;
    const offset = Math.floor(bounded * count);

    const row = this.db.prepare(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT 1 OFFSET ?
    `).get(...params, offset);

    return this.hydrate(row);
  }

  findLongest({ themeTags = [] } = {}) {
    const { whereSql, params } = buildFilter(themeTags, [0, Number.POSITIVE_INFINITY]);
    const row = this.db.prepare(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.step_count DESC, p.puzzle_id ASC
      LIMIT 1
    `).get(...params);

    return this.hydrate(row);
  }
}
