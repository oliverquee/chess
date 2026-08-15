import { computeEvalDelta } from '../engine/eval.js';
import {
  getGameById,
  saveMoveClassification,
  transitionGameStatus,
} from '../storage/db.js';
import { loadPrompt } from './promptRegistry.js';
import {
  validateMoveClassification,
  validateProgressReview,
  validateWeaknessRanking,
} from './schemas.js';
import { runStructuredAnalysis } from './structuredRunner.js';

export function classifyGamePhase(fenBefore, plyNumber) {
  if (typeof fenBefore !== 'string' || !fenBefore.trim()) throw new TypeError('fenBefore must be a non-empty string.');
  if (!Number.isInteger(plyNumber) || plyNumber < 1) throw new TypeError('plyNumber must be a positive integer.');
  if (plyNumber <= 20) return 'opening';
  const board = fenBefore.split(' ')[0].toLowerCase();
  const queens = [...board].filter((piece) => piece === 'q').length;
  const nonPawnMaterial = [...board].filter((piece) => ['n', 'b', 'r', 'q'].includes(piece)).length;
  return queens === 0 || nonPawnMaterial <= 6 ? 'endgame' : 'middlegame';
}

export class AnalysisService {
  constructor({ backend, now = () => new Date().toISOString() }) {
    if (!backend || typeof backend.generate !== 'function') throw new TypeError('backend must provide generate(request).');
    this.backend = backend;
    this.now = now;
    this.prompts = {
      move: loadPrompt('move'),
      ranking: loadPrompt('ranking'),
      progress: loadPrompt('progress'),
    };
  }

  classifyMove(move) {
    if (!move || typeof move !== 'object') throw new TypeError('move must be an object.');
    const input = {
      fen_before: move.fen_before,
      move_played: move.move_played,
      stockfish_best_move: move.best_move,
      normalized_eval_delta_cp: computeEvalDelta(move),
      game_phase: classifyGamePhase(move.fen_before, move.ply_number),
    };
    return runStructuredAnalysis({
      backend: this.backend,
      prompt: this.prompts.move,
      input,
      validate: validateMoveClassification,
      now: this.now,
    });
  }

  rankWeaknesses({ classifications, eligiblePuzzles }) {
    if (!Array.isArray(classifications)) throw new TypeError('classifications must be an array.');
    if (!Array.isArray(eligiblePuzzles)) throw new TypeError('eligiblePuzzles must be an array.');
    const eligiblePuzzleIds = eligiblePuzzles.map((puzzle) => puzzle.PuzzleId ?? puzzle.puzzle_id);
    if (eligiblePuzzleIds.some((id) => typeof id !== 'string' || !id)) {
      throw new TypeError('Every eligible puzzle must have a PuzzleId or puzzle_id.');
    }
    const evidenceCounts = {};
    for (const classification of classifications) {
      const category = classification?.category ?? classification?.value?.category;
      if (category) evidenceCounts[category] = (evidenceCounts[category] ?? 0) + 1;
    }
    return runStructuredAnalysis({
      backend: this.backend,
      prompt: this.prompts.ranking,
      input: { classifications, eligible_puzzles: eligiblePuzzles },
      validate: (value) => validateWeaknessRanking(value, { eligiblePuzzleIds, evidenceCounts }),
      now: this.now,
    });
  }

  reviewProgress({ before, after }) {
    return runStructuredAnalysis({
      backend: this.backend,
      prompt: this.prompts.progress,
      input: { before, after },
      validate: validateProgressReview,
      now: this.now,
    });
  }

  async analyzeStoredGame(db, gameId) {
    const game = getGameById(db, gameId);
    if (game.status !== 'completed') {
      throw new Error(`Game ${gameId} must be completed before analysis; current status is ${game.status}.`);
    }
    if (game.mode === 'imported' && !['white', 'black'].includes(game.player_color)) {
      throw new Error(`Imported game ${gameId} is missing a valid player_color.`);
    }
    const moves = game.mode === 'imported'
      ? game.moves.filter((move) => move.fen_before.split(' ')[1] === game.player_color[0])
      : game.moves;
    const results = [];
    for (const move of moves) {
      const result = await this.classifyMove(move);
      saveMoveClassification(db, move.id, result);
      results.push({ moveId: move.id, ...result });
    }
    transitionGameStatus(db, gameId, 'analyzed');
    return { gameId, results };
  }
}
