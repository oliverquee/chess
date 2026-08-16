import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { saveGameSession } from '../storage/db.js';
import { fetchChessComMonthlyArchive } from './chessComArchive.js';

const COMPLETED_RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
const STANDARD_VARIANTS = new Set(['standard', 'chess']);

export class ImportValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ImportValidationError';
  }
}

function stableHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parsePgn(pgn) {
  if (typeof pgn !== 'string' || !pgn.trim()) throw new ImportValidationError('pgn must be a non-empty string.');
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch (error) {
    throw new ImportValidationError(`Invalid PGN: ${error.message}`, { cause: error });
  }
  const headers = chess.getHeaders();
  const variant = headers.Variant?.trim().toLowerCase();
  if (variant && !STANDARD_VARIANTS.has(variant)) {
    throw new ImportValidationError(`Only standard chess is importable; received Variant=${headers.Variant}.`);
  }
  if (!COMPLETED_RESULTS.has(headers.Result)) {
    throw new ImportValidationError(`Only completed games are importable; received Result=${headers.Result ?? 'missing'}.`);
  }
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) throw new ImportValidationError('Completed PGN contains no moves.');
  return { chess, headers, moves };
}

function playerMetadata(headers, username) {
  if (typeof username !== 'string' || !username.trim()) throw new TypeError('username must be a non-empty string.');
  const target = username.trim().toLowerCase();
  const white = headers.White?.trim();
  const black = headers.Black?.trim();
  if (white?.toLowerCase() === target) return { playerColor: 'white', white, black };
  if (black?.toLowerCase() === target) return { playerColor: 'black', white, black };
  throw new ImportValidationError(`Username ${username} is neither White nor Black in the PGN.`);
}

function validatePgnForUser(pgn, username) {
  const parsed = parsePgn(pgn);
  return { ...parsed, player: playerMetadata(parsed.headers, username) };
}

function pgnDate(headers) {
  const date = headers.UTCDate ?? headers.Date;
  if (!date || !/^\d{4}\.\d{2}\.\d{2}$/.test(date) || date.includes('?')) return null;
  const time = /^\d{2}:\d{2}:\d{2}$/.test(headers.UTCTime ?? '') ? headers.UTCTime : '00:00:00';
  const iso = `${date.replaceAll('.', '-')}T${time}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function normalizeAnalysis(result) {
  if (!result || typeof result !== 'object') throw new Error('Stockfish returned no analysis result.');
  return {
    evalCp: result.evalCp ?? null,
    bestMove: result.bestMove ?? null,
    principalVariation: Array.isArray(result.principalVariation) ? result.principalVariation.join(' ') : null,
    isMateScore: Boolean(result.isMateScore),
  };
}

export async function buildImportedGameSummary({
  pgn,
  username,
  engine,
  importSource = 'chesscom_manual',
  externalGameId,
  completedAt,
  now = () => new Date().toISOString(),
  gameId,
}) {
  if (!engine || typeof engine.analyzePosition !== 'function') {
    throw new TypeError('engine must provide analyzePosition(fen).');
  }
  const { chess, headers, moves, player } = validatePgnForUser(pgn, username);
  const { playerColor, white, black } = player;
  const analysisTimestamp = now();
  const pgnHash = stableHash(pgn.trim());
  const externalId = externalGameId ?? pgnHash;
  const id = gameId ?? `import-${stableHash(`${importSource}:${externalId}`).slice(0, 24)}`;
  const cache = new Map();
  const analyze = async (fen) => {
    if (!cache.has(fen)) cache.set(fen, Promise.resolve(engine.analyzePosition(fen)).then(normalizeAnalysis));
    return cache.get(fen);
  };

  const records = [];
  for (const [index, move] of moves.entries()) {
    const before = await analyze(move.before);
    const after = await analyze(move.after);
    records.push({
      game_id: id,
      ply_number: index + 1,
      fen_before: move.before,
      move_played: move.lan,
      eval_cp_before: before.evalCp,
      eval_cp_after: after.evalCp,
      best_move: before.bestMove,
      principal_variation: before.principalVariation,
      is_mate_score: before.isMateScore || after.isMateScore ? 1 : 0,
      stockfish_response: null,
      timestamp: analysisTimestamp,
      timestamp_source: 'posthoc_analysis',
    });
  }

  return {
    id,
    date: completedAt ?? pgnDate(headers) ?? analysisTimestamp,
    mode: 'imported',
    result: headers.Result,
    start_fen: moves[0].before,
    current_fen: chess.fen(),
    moves: records,
    import_source: importSource,
    external_game_id: externalId,
    player_color: playerColor,
    white_player: white,
    black_player: black,
    analysis_engine: engine.engineName ?? 'Stockfish',
    analysis_depth: Number.isInteger(engine.analysisDepth) ? engine.analysisDepth : null,
  };
}

export async function importCompletedPgn({ db, ...options }) {
  const importSource = options.importSource ?? 'chesscom_manual';
  const externalGameId = options.externalGameId ?? stableHash(options.pgn?.trim() ?? '');
  const duplicate = db.prepare(`
    SELECT id FROM games WHERE import_source = ? AND external_game_id = ?
  `).get(importSource, externalGameId);
  if (duplicate) throw new ImportValidationError(`Duplicate imported game: ${duplicate.id}.`);
  const summary = await buildImportedGameSummary({ ...options, importSource, externalGameId });
  saveGameSession(db, summary);
  return summary;
}

export async function importChessComMonthlyArchive({
  db,
  username,
  year,
  month,
  engineFactory,
  fetchImpl = fetch,
  now,
}) {
  if (typeof engineFactory !== 'function') throw new TypeError('engineFactory must be a function.');
  const games = await fetchChessComMonthlyArchive({ username, year, month, fetchImpl });
  const imported = [];
  const skipped = [];
  for (const game of games) {
    if (game?.rules !== 'chess') {
      skipped.push({ reason: 'non_standard', id: game?.uuid ?? game?.url ?? null });
      continue;
    }
    if (typeof game.pgn !== 'string') {
      skipped.push({ reason: 'missing_pgn', id: game?.uuid ?? game?.url ?? null });
      continue;
    }
    try {
      validatePgnForUser(game.pgn, username);
    } catch (error) {
      if (!(error instanceof ImportValidationError)) throw error;
      skipped.push({ reason: error.message, id: game?.uuid ?? game?.url ?? null });
      continue;
    }
    const externalGameId = game.uuid ?? game.url ?? stableHash(game.pgn.trim());
    const duplicate = db.prepare(`
      SELECT id FROM games WHERE import_source = 'chesscom_archive' AND external_game_id = ?
    `).get(externalGameId);
    if (duplicate) {
      skipped.push({ reason: 'duplicate', id: externalGameId });
      continue;
    }
    const engine = engineFactory(game);
    try {
      const summary = await importCompletedPgn({
        db,
        pgn: game.pgn,
        username,
        engine,
        importSource: 'chesscom_archive',
        externalGameId,
        completedAt: Number.isInteger(game.end_time) ? new Date(game.end_time * 1000).toISOString() : undefined,
        now,
      });
      imported.push(summary.id);
    } catch (error) {
      if (!(error instanceof ImportValidationError)) throw error;
      skipped.push({ reason: error.message, id: game?.uuid ?? game?.url ?? null });
    } finally {
      engine.dispose?.();
    }
  }
  return { imported, skipped };
}
