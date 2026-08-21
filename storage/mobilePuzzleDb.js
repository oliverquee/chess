// Mobile/Capacitor async equivalent of data/puzzleDb.js
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const PUZZLE_SCHEMA_SQL = `
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
`;

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

export async function initMobilePuzzleDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');
  
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(path, false, "no-encryption", 1, false);
  await db.open();

  await db.execute('BEGIN IMMEDIATE');
  try {
    const statements = PUZZLE_SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.execute(stmt + ';');
    }
    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }

  return db;
}

export async function openMobilePuzzleDb(path) {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError('path must be a non-empty string.');
  
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(path, false, "no-encryption", 1, true);
  await db.open();
  
  return db;
}

export class MobileSqlitePuzzleLibrary {
  constructor(db) {
    if (!db) {
      throw new TypeError('db must be a capacitor sqlite connection object.');
    }
    this.db = db;
  }

  async hydrate(row) {
    if (!row) return null;
    
    const res = await this.db.query(`
      SELECT theme
      FROM puzzle_themes
      WHERE puzzle_id = ?
      ORDER BY theme ASC
    `, [row.puzzle_id]);
    
    const themes = (res.values || []).map((item) => item.theme);
    return rowToPuzzle(row, themes);
  }

  async filter({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY], limit = 1000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
      throw new RangeError('limit must be an integer from 1 to 10000 for SQLite puzzle queries.');
    }

    const { whereSql, params } = buildFilter(themeTags, stepRange);
    
    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT ?
    `, [...params, limit]);

    const rows = res.values || [];
    const puzzles = [];
    for (const row of rows) {
      puzzles.push(await this.hydrate(row));
    }
    
    return puzzles;
  }

  async sample({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY] } = {}, random = Math.random) {
    const { whereSql, params } = buildFilter(themeTags, stepRange);
    
    const countRes = await this.db.query(`
      SELECT COUNT(*) AS count
      FROM puzzles p
      WHERE ${whereSql}
    `, params);
    
    const countRow = countRes.values?.[0];
    const count = countRow ? Number(countRow.count) : 0;
    if (count === 0) return null;

    const randomValue = Number(random());
    const bounded = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999999, randomValue)) : 0;
    const offset = Math.floor(bounded * count);

    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT 1 OFFSET ?
    `, [...params, offset]);

    const row = res.values?.[0];
    return await this.hydrate(row);
  }

  async findLongest({ themeTags = [] } = {}) {
    const { whereSql, params } = buildFilter(themeTags, [0, Number.POSITIVE_INFINITY]);
    
    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.step_count DESC, p.puzzle_id ASC
      LIMIT 1
    `, params);

    const row = res.values?.[0];
    return await this.hydrate(row);
  }
}
