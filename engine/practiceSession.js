import { analyzePosition as defaultAnalyzePosition, playMove as defaultPlayMove } from './stockfishWorker.js';
import { applyUciMoveToFen } from './fen.js';

function createDefaultEngine() {
  return {
    analyzePosition: defaultAnalyzePosition,
    playMove: defaultPlayMove,
  };
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `practice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return { bestMove: null, evalCp: null, principalVariation: [], isMateScore: false };
  }

  return {
    bestMove: analysis.bestMove ?? null,
    evalCp: analysis.evalCp ?? null,
    principalVariation: Array.isArray(analysis.principalVariation) ? analysis.principalVariation : [],
    isMateScore: Boolean(analysis.isMateScore),
  };
}

function getSetupMove(puzzle) {
  const moves = Array.isArray(puzzle?.moves)
    ? puzzle.moves
    : String(puzzle?.Moves ?? '').trim().split(/\s+/).filter(Boolean);
  if (!moves.length) {
    throw new Error('A Lichess seed puzzle with Moves[0] setup move is required.');
  }
  return moves[0];
}

export function getMotifReadyFen(puzzle) {
  if (!puzzle?.FEN) throw new Error('A seed puzzle with FEN is required.');
  return applyUciMoveToFen(puzzle.FEN, getSetupMove(puzzle));
}

export class PracticeSession {
  constructor({
    puzzle,
    skillLevel = 10,
    analysisDepth = 14,
    engine = createDefaultEngine(),
    gameId = defaultId(),
    now = () => new Date().toISOString(),
  }) {
    if (!puzzle?.FEN) throw new Error('A seed puzzle with FEN is required.');
    if (!engine?.analyzePosition || !engine?.playMove) {
      throw new TypeError('engine must provide analyzePosition() and playMove().');
    }

    this.puzzle = puzzle;
    this.skillLevel = skillLevel;
    this.analysisDepth = analysisDepth;
    this.engine = engine;
    this.gameId = gameId;
    this.now = now;
    this.startFen = getMotifReadyFen(puzzle);
    this.currentFen = this.startFen;
    this.logs = [];
    this.ended = false;
    this.result = null;
  }

  get nextPlyNumber() {
    return this.logs.length + 1;
  }

  async evaluate(fen) {
    return normalizeAnalysis(await this.engine.analyzePosition(fen, this.analysisDepth));
  }

  makeLog({ plyNumber, fenBefore, movePlayed, beforeAnalysis, afterAnalysis, stockfishResponse = null }) {
    const before = normalizeAnalysis(beforeAnalysis);
    const after = normalizeAnalysis(afterAnalysis);

    return {
      game_id: this.gameId,
      ply_number: plyNumber,
      fen_before: fenBefore,
      move_played: movePlayed,
      eval_cp_before: before.evalCp,
      eval_cp_after: after.evalCp,
      best_move: before.bestMove,
      principal_variation: before.principalVariation.length ? before.principalVariation.join(' ') : null,
      is_mate_score: before.isMateScore || after.isMateScore ? 1 : 0,
      stockfish_response: stockfishResponse,
      timestamp: this.now(),
    };
  }

  async playTurn(playerMove) {
    if (this.ended) throw new Error('Practice session has ended.');

    const playerFenBefore = this.currentFen;
    const playerBeforeAnalysis = await this.evaluate(playerFenBefore);
    const playerFenAfter = applyUciMoveToFen(playerFenBefore, playerMove);
    const playerAfterAnalysis = await this.evaluate(playerFenAfter);

    const playerLog = this.makeLog({
      plyNumber: this.nextPlyNumber,
      fenBefore: playerFenBefore,
      movePlayed: playerMove,
      beforeAnalysis: playerBeforeAnalysis,
      afterAnalysis: playerAfterAnalysis,
    });

    const engineFenBefore = playerFenAfter;
    const engineBeforeAnalysis = playerAfterAnalysis;
    const engineMove = await this.engine.playMove(engineFenBefore, this.skillLevel);

    if (!engineMove) {
      this.currentFen = playerFenAfter;
      this.logs.push(playerLog);
      return { playerLog, engineLog: null, currentFen: this.currentFen };
    }

    playerLog.stockfish_response = engineMove;
    const engineFenAfter = applyUciMoveToFen(engineFenBefore, engineMove);
    const engineAfterAnalysis = await this.evaluate(engineFenAfter);

    const engineLog = this.makeLog({
      plyNumber: this.nextPlyNumber + 1,
      fenBefore: engineFenBefore,
      movePlayed: engineMove,
      beforeAnalysis: engineBeforeAnalysis,
      afterAnalysis: engineAfterAnalysis,
    });

    // Commit the turn only after every required operation succeeds. A worker
    // failure or illegal engine move leaves the previous session state intact.
    this.currentFen = engineFenAfter;
    this.logs.push(playerLog, engineLog);

    return { playerLog, engineLog, currentFen: this.currentFen };
  }

  async run(moveProvider, { maxTurns = Number.POSITIVE_INFINITY } = {}) {
    if (typeof moveProvider !== 'function') throw new TypeError('moveProvider must be a function.');

    let turns = 0;
    while (!this.ended && turns < maxTurns) {
      const move = await moveProvider({
        fen: this.currentFen,
        logs: [...this.logs],
        turn: turns,
      });
      if (!move) break;
      await this.playTurn(move);
      turns += 1;
    }

    return this.summary();
  }

  end(result = null) {
    this.ended = true;
    this.result = result;
    return this.summary();
  }

  summary() {
    return {
      id: this.gameId,
      mode: 'practice',
      seeded_weakness: this.puzzle.weaknessCategory ?? null,
      seed_puzzle_id: this.puzzle.PuzzleId ?? null,
      start_fen: this.startFen,
      current_fen: this.currentFen,
      result: this.result,
      moves: [...this.logs],
    };
  }
}

export function createSeededPracticeSession(options) {
  return new PracticeSession(options);
}
