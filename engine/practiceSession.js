import { analyzePosition as defaultAnalyzePosition, playMove as defaultPlayMove, PERSONAS, resolvePersona } from './stockfishWorker.js';
import { applyUciMoveToFen } from './fen.js';

const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
    puzzle = null,
    mode = puzzle ? 'practice' : 'freeplay',
    startFen = null,
    skillLevel = 10,
    persona = 'tabby',
    timeControl = '5|0',
    playerColor = 'white',
    analysisDepth = 14,
    engine = createDefaultEngine(),
    gameId = defaultId(),
    now = () => new Date().toISOString(),
  } = {}) {
    if (!engine?.analyzePosition || !engine?.playMove) {
      throw new TypeError('engine must provide analyzePosition() and playMove().');
    }

    this.puzzle = puzzle;
    this.mode = mode;
    this.skillLevel = skillLevel;
    this.persona = typeof persona === 'object' && persona?.id ? persona.id : (persona || 'tabby');
    this.timeControl = timeControl;
    this.analysisDepth = analysisDepth;
    this.engine = engine;
    this.gameId = gameId;
    this.now = now;

    // Resolve player color (support random)
    if (playerColor === 'random') {
      this.playerColor = Math.random() < 0.5 ? 'white' : 'black';
    } else {
      this.playerColor = playerColor === 'black' ? 'black' : 'white';
    }

    if (puzzle?.FEN) {
      this.startFen = getMotifReadyFen(puzzle);
    } else {
      this.startFen = startFen || STANDARD_START_FEN;
    }
    this.currentFen = this.startFen;
    this.logs = [];
    this.hints = [];
    this.hintCount = 0;
    this.takebackCount = 0;
    this.previewUsed = false;
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
    const engineMove = await this.engine.playMove(engineFenBefore, this.persona ?? this.skillLevel);

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

  async playEngineMove() {
    if (this.ended) throw new Error('Practice session has ended.');
    const fenBefore = this.currentFen;
    const beforeAnalysis = await this.evaluate(fenBefore);
    const engineMove = await this.engine.playMove(fenBefore, this.persona ?? this.skillLevel);

    if (!engineMove) return null;

    const fenAfter = applyUciMoveToFen(fenBefore, engineMove);
    const afterAnalysis = await this.evaluate(fenAfter);

    const engineLog = this.makeLog({
      plyNumber: this.nextPlyNumber,
      fenBefore,
      movePlayed: engineMove,
      beforeAnalysis,
      afterAnalysis,
    });

    this.currentFen = fenAfter;
    this.logs.push(engineLog);
    return { engineLog, currentFen: this.currentFen };
  }

  takeback() {
    if (this.ended) throw new Error('Cannot take back moves on an ended session.');
    if (this.logs.length === 0) return null;

    // Take back a full turn (2 plies: player + engine response), or 1 ply if only 1 exists
    const pliesToRemove = Math.min(2, this.logs.length);
    const removedLogs = this.logs.splice(this.logs.length - pliesToRemove, pliesToRemove);
    this.currentFen = removedLogs[0].fen_before;
    this.takebackCount += 1;

    return {
      revertedFen: this.currentFen,
      takebackCount: this.takebackCount,
      removedLogs,
    };
  }

  recordHint(tier, detector = null) {
    this.hintCount += 1;
    const log = {
      tier,
      detector,
      fen: this.currentFen,
      timestamp: this.now(),
    };
    this.hints.push(log);
    return log;
  }

  recordPreview() {
    this.previewUsed = true;
  }

  resign(color = this.playerColor) {
    this.ended = true;
    this.result = color === 'white' ? '0-1' : '1-0';
    return this.summary();
  }

  async offerDraw() {
    if (this.ended) throw new Error('Session is already ended.');
    const analysis = await this.evaluate(this.currentFen);
    const cp = analysis.evalCp;

    // If position is balanced (|eval| <= 75 and not mate), Stockfish accepts draw
    if (cp !== null && Math.abs(cp) <= 75 && !analysis.isMateScore) {
      this.ended = true;
      this.result = '1/2-1/2';
      return { accepted: true, result: '1/2-1/2', summary: this.summary() };
    }

    return {
      accepted: false,
      reason: 'Engine evaluated position as advantageous and declined the draw.',
    };
  }

  computeAssistanceLevel() {
    if (this.hintCount === 0 && this.takebackCount === 0 && !this.previewUsed) {
      return 'none';
    }
    if (this.takebackCount > 1) {
      return 'full';
    }
    if (this.hintCount > 0 || this.takebackCount === 1) {
      return 'hints';
    }
    if (this.previewUsed) {
      return 'preview';
    }
    return 'full';
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
      mode: this.mode,
      seeded_weakness: this.puzzle?.weaknessCategory ?? null,
      seed_puzzle_id: this.puzzle?.PuzzleId ?? null,
      start_fen: this.startFen,
      current_fen: this.currentFen,
      result: this.result,
      player_color: this.playerColor,
      time_control: this.timeControl,
      persona: this.persona,
      assistance_level: this.computeAssistanceLevel(),
      hint_count: this.hintCount,
      takeback_count: this.takebackCount,
      moves: [...this.logs],
    };
  }
}

export function createSeededPracticeSession(options) {
  return new PracticeSession(options);
}

export function createFreeplaySession(options = {}) {
  return new PracticeSession({ ...options, mode: 'freeplay' });
}

