import { AnalysisService } from '../analysis/service.js';
import { getGameHistory } from '../storage/db.js';
import { importChessComMonthlyArchive, importCompletedPgn } from '../import/pgnImport.js';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

export class AppController {
  constructor({ db, orchestrator, engineFactory, backendFactory, secretStore }) {
    this.db = db;
    this.orchestrator = orchestrator;
    this.engineFactory = engineFactory;
    this.backendFactory = backendFactory;
    this.secretStore = secretStore;
  }

  getState() {
    return { games: getGameHistory(this.db, { limit: 20 }) };
  }

  startPractice({ rankedWeaknesses } = {}) {
    const result = this.orchestrator.startTargetedSession(rankedWeaknesses);
    if (!result.activeSession) return { weaknessCategory: null, skipped: result.skipped, queued: [] };
    return {
      mode: 'practice',
      gameId: result.activeSession.gameId,
      fen: result.activeSession.currentFen,
      weaknessCategory: result.weaknessCategory,
      skipped: result.skipped,
      queued: result.queued.map(({ id, puzzle }) => ({ id, puzzleId: puzzle.PuzzleId })),
    };
  }

  startNextPractice() {
    const session = this.orchestrator.startNextQueuedSession();
    return session ? { mode: 'practice', gameId: session.gameId, fen: session.currentFen } : null;
  }

  async playPracticeMove({ gameId, move }) {
    const session = this.orchestrator.sessions.get(required(gameId, 'gameId'));
    if (!session) throw new Error(`Active practice session not found: ${gameId}`);
    const turn = await session.playTurn(required(move, 'move'));
    return {
      mode: 'practice',
      gameId,
      fen: turn.currentFen,
      playerMove: turn.playerLog.move_played,
      engineMove: turn.engineLog?.move_played ?? null,
      futureLine: turn.playerLog.principal_variation?.split(/\s+/).filter(Boolean) ?? [],
    };
  }

  completePractice({ gameId, result = '*' }) {
    const session = this.orchestrator.sessions.get(required(gameId, 'gameId'));
    if (!session) throw new Error(`Active practice session not found: ${gameId}`);
    const summary = session.end(result);
    this.orchestrator.completeSession(summary);
    session.engine.dispose?.();
    return { gameId, status: 'completed' };
  }

  async importPgn({ pgn, username }) {
    const engine = this.engineFactory();
    try {
      const summary = await importCompletedPgn({
        db: this.db,
        pgn: required(pgn, 'pgn'),
        username: required(username, 'username'),
        engine,
      });
      return { gameId: summary.id, status: 'completed', mode: 'imported' };
    } finally {
      engine.dispose?.();
    }
  }

  importArchive({ username, year, month }) {
    return importChessComMonthlyArchive({
      db: this.db,
      username: required(username, 'username'),
      year,
      month,
      engineFactory: this.engineFactory,
    });
  }

  async analyzeGame({ gameId, backend, model }) {
    const selected = required(backend, 'backend');
    const backendInstance = this.backendFactory({
      backend: selected,
      model: required(model, 'model'),
      claudeApiKey: selected === 'claude' ? this.secretStore.get('claude_api_key') : null,
    });
    const service = new AnalysisService({ backend: backendInstance });
    const result = await service.analyzeStoredGame(this.db, required(gameId, 'gameId'));
    return {
      gameId: result.gameId,
      classified: result.results.filter((entry) => entry.status === 'classified').length,
      unclassified: result.results.filter((entry) => entry.status === 'unclassified').length,
    };
  }

  setClaudeKey({ apiKey }) {
    this.secretStore.set('claude_api_key', required(apiKey, 'apiKey'));
    return { stored: true };
  }

  hasClaudeKey() {
    return { stored: this.secretStore.has('claude_api_key') };
  }

  deleteClaudeKey() {
    return { deleted: this.secretStore.delete('claude_api_key') };
  }
}
