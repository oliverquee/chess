import { getPuzzlesForWeakness } from '../data/themeMapping.js';
import { getMotifReadyFen, PracticeSession } from '../engine/practiceSession.js';
import * as defaultDbStorage from '../storage/db.js';
import { selectSeedableTarget } from './targeting.js';

function defaultIdFactory({ puzzle, index }) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${puzzle.PuzzleId ?? 'seed'}-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class TrainingOrchestrator {
  constructor({
    db,
    storage = defaultDbStorage,
    puzzleLibrary,
    engineFactory,
    idFactory = defaultIdFactory,
    now = () => new Date().toISOString(),
  }) {
    if (!db) throw new TypeError('db must be provided.');
    if (!storage || typeof storage !== 'object') throw new TypeError('storage adapter must be provided.');
    if (!puzzleLibrary?.filter) throw new TypeError('puzzleLibrary must provide filter(query).');
    if (typeof engineFactory !== 'function') throw new TypeError('engineFactory must be a function.');
    this.db = db;
    this.storage = storage;
    this.puzzleLibrary = puzzleLibrary;
    this.engineFactory = engineFactory;
    this.idFactory = idFactory;
    this.now = now;
    this.queue = [];
    this.sessions = new Map();
  }

  async getNextFocus(rankedWeaknesses) {
    const weaknesses = rankedWeaknesses ?? (await this.storage.getWeaknessTally(this.db));
    return selectSeedableTarget(weaknesses, {
      getPuzzles: (category, bucket) => getPuzzlesForWeakness(category, bucket, {
        library: this.puzzleLibrary,
      }),
    });
  }

  async startTargetedSession(rankedWeaknesses) {
    const weaknesses = rankedWeaknesses ?? (await this.storage.getWeaknessTally(this.db));
    const focus = await this.getNextFocus(weaknesses);
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
    await this.storage.createQueuedGames(this.db, queued);
    this.queue.push(...queued);

    const activeSession = await this.startQueuedSession(queued[0].id);
    return { ...focus, activeSession, queued };
  }

  async startQueuedSession(gameId) {
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
    await this.storage.transitionGameStatus(this.db, gameId, 'in_progress');
    this.sessions.set(gameId, session);
    return session;
  }

  async startNextQueuedSession() {
    for (const item of this.queue) {
      const status = await this.storage.getGameStatus(this.db, item.id);
      if (status === 'queued') {
        return await this.startQueuedSession(item.id);
      }
    }
    return null;
  }

  async completeSession(sessionOrSummary) {
    const summary = typeof sessionOrSummary?.summary === 'function'
      ? sessionOrSummary.summary()
      : sessionOrSummary;
    await this.storage.completeGameSession(this.db, summary);
    this.sessions.delete(summary.id);
    return summary.id;
  }

  async markAnalyzed(gameId) {
    return await this.storage.transitionGameStatus(this.db, gameId, 'analyzed');
  }
}
