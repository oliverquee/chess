import { getPuzzlesForWeakness } from '../data/themeMapping.js';
import { getMotifReadyFen, PracticeSession } from '../engine/practiceSession.js';
import {
  completeGameSession,
  createQueuedGames,
  getGameStatus,
  getWeaknessTally,
  transitionGameStatus,
} from '../storage/db.js';
import { selectSeedableTarget } from './targeting.js';

function defaultIdFactory({ puzzle, index }) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${puzzle.PuzzleId ?? 'seed'}-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class TrainingOrchestrator {
  constructor({
    db,
    puzzleLibrary,
    engineFactory,
    idFactory = defaultIdFactory,
    now = () => new Date().toISOString(),
  }) {
    if (!db?.prepare) throw new TypeError('db must be a SQLite handle.');
    if (!puzzleLibrary?.filter) throw new TypeError('puzzleLibrary must provide filter(query).');
    if (typeof engineFactory !== 'function') throw new TypeError('engineFactory must be a function.');
    this.db = db;
    this.puzzleLibrary = puzzleLibrary;
    this.engineFactory = engineFactory;
    this.idFactory = idFactory;
    this.now = now;
    this.queue = [];
    this.sessions = new Map();
  }

  getNextFocus(rankedWeaknesses = getWeaknessTally(this.db)) {
    return selectSeedableTarget(rankedWeaknesses, {
      getPuzzles: (category, bucket) => getPuzzlesForWeakness(category, bucket, {
        library: this.puzzleLibrary,
      }),
    });
  }

  startTargetedSession(rankedWeaknesses = getWeaknessTally(this.db)) {
    const focus = this.getNextFocus(rankedWeaknesses);
    if (!focus.weaknessCategory) return { ...focus, activeSession: null, queued: [] };
    if (focus.puzzles.length !== 2) {
      throw new Error(`Start-slow targeting must return exactly two puzzles; received ${focus.puzzles.length}.`);
    }

    const queued = focus.puzzles.map((puzzle, index) => {
      const id = this.idFactory({ puzzle, index, weaknessCategory: focus.weaknessCategory });
      return {
        id,
        puzzle,
        weaknessCategory: focus.weaknessCategory,
        date: this.now(),
        seeded_weakness: focus.weaknessCategory,
        seed_puzzle_id: puzzle.PuzzleId ?? null,
        start_fen: getMotifReadyFen(puzzle),
      };
    });
    createQueuedGames(this.db, queued);
    this.queue.push(...queued);

    const activeSession = this.startQueuedSession(queued[0].id);
    return { ...focus, activeSession, queued };
  }

  startQueuedSession(gameId) {
    const descriptor = this.queue.find((item) => item.id === gameId);
    if (!descriptor) throw new Error(`Queued session not found: ${gameId}`);
    const session = new PracticeSession({
      puzzle: {
        ...descriptor.puzzle,
        weaknessCategory: descriptor.weaknessCategory,
      },
      engine: this.engineFactory(descriptor),
      gameId,
      now: this.now,
    });
    transitionGameStatus(this.db, gameId, 'in_progress');
    this.sessions.set(gameId, session);
    return session;
  }

  startNextQueuedSession() {
    const descriptor = this.queue.find((item) => getGameStatus(this.db, item.id) === 'queued');
    return descriptor ? this.startQueuedSession(descriptor.id) : null;
  }

  completeSession(sessionOrSummary) {
    const summary = typeof sessionOrSummary?.summary === 'function'
      ? sessionOrSummary.summary()
      : sessionOrSummary;
    completeGameSession(this.db, summary);
    this.sessions.delete(summary.id);
    return summary.id;
  }

  markAnalyzed(gameId) {
    return transitionGameStatus(this.db, gameId, 'analyzed');
  }
}
