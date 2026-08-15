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
    this.startFen = puzzle.FEN;
    this.currentFen = puzzle.FEN;
    this.logs = [];
    this.ended = false;
    this.result = null;
  }

  get nextPlyNumber() {
    return this.logs.length + 1;
  }

  async evaluate(fen) {
    return this.engine.analyzePosition(fen, this.analysisDepth);
  }

  makeLog({ fenBefore, movePlayed, evalCp, stockfishResponse = null }) {
    return {
      game_id: this.gameId,
      ply_number: this.nextPlyNumber,
      fen_before: fenBefore,
      move_played: movePlayed,
      eval_cp: evalCp,
      stockfish_response: stockfishResponse,
      timestamp: this.now(),
    };
  }

  async playTurn(playerMove) {
    if (this.ended) throw new Error('Practice session has ended.');

    const playerFenBefore = this.currentFen;
    const playerEvaluation = await this.evaluate(playerFenBefore);
    this.currentFen = applyUciMoveToFen(this.currentFen, playerMove);

    const playerLog = this.makeLog({
      fenBefore: playerFenBefore,
      movePlayed: playerMove,
      evalCp: playerEvaluation.evalCp,
    });
    this.logs.push(playerLog);

    const engineFenBefore = this.currentFen;
    const engineEvaluation = await this.evaluate(engineFenBefore);
    const engineMove = await this.engine.playMove(engineFenBefore, this.skillLevel);

    if (!engineMove) {
      return { playerLog, engineLog: null, currentFen: this.currentFen };
    }

    playerLog.stockfish_response = engineMove;
    this.currentFen = applyUciMoveToFen(this.currentFen, engineMove);

    const engineLog = this.makeLog({
      fenBefore: engineFenBefore,
      movePlayed: engineMove,
      evalCp: engineEvaluation.evalCp,
    });
    this.logs.push(engineLog);

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
