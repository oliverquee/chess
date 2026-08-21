const DEFAULT_ANALYSIS_DEPTH = 16;
const DEFAULT_PLAY_DEPTH = 12;
const MATE_SCORE_CP = 100000;

export const PERSONAS = Object.freeze({
  kitten: Object.freeze({
    id: 'kitten',
    name: 'Kitten',
    avatar: '🐱',
    theme: 'orange-tabby',
    targetElo: 800,
    uciLimitStrength: false,
    skillLevel: 0,
    depth: 1,
    description: 'Playful and makes frequent blunders (~800 Elo)',
  }),
  tabby: Object.freeze({
    id: 'tabby',
    name: 'Tabby',
    avatar: '🐱',
    theme: 'orange-tabby',
    targetElo: 1200,
    uciLimitStrength: false,
    skillLevel: 3,
    depth: 4,
    description: 'Casual club player with basic tactical awareness (~1200 Elo)',
  }),
  alley_cat: Object.freeze({
    id: 'alley_cat',
    name: 'Alley Cat',
    avatar: '🐈',
    theme: 'calico',
    targetElo: 1500,
    uciLimitStrength: true,
    uciElo: 1500,
    depth: 8,
    description: 'Solid intermediate player with sharp eyes (~1500 Elo)',
  }),
  hunter: Object.freeze({
    id: 'hunter',
    name: 'Hunter',
    avatar: '🐆',
    theme: 'fox',
    targetElo: 1800,
    uciLimitStrength: true,
    uciElo: 1800,
    depth: 12,
    description: 'Dangerous attacking player with strong fundamentals (~1800 Elo)',
  }),
  panther: Object.freeze({
    id: 'panther',
    name: 'Panther',
    avatar: '🐆',
    theme: 'black-cat',
    targetElo: 2100,
    uciLimitStrength: true,
    uciElo: 2100,
    depth: 16,
    description: 'Master-level tactician who pounces on any inaccuracy (~2100 Elo)',
  }),
  apex_tiger: Object.freeze({
    id: 'apex_tiger',
    name: 'Apex Tiger',
    avatar: '🐅',
    theme: 'panda',
    targetElo: 2800,
    uciLimitStrength: false,
    skillLevel: 20,
    depth: 20,
    description: 'Uncapped Stockfish engine at maximum strength (~2800+ Elo)',
  }),
});

export function resolvePersona(config) {
  if (!config) return PERSONAS.tabby;
  if (typeof config === 'string') {
    const key = config.toLowerCase().replace(/[-\s]/g, '_');
    return PERSONAS[key] ?? PERSONAS.tabby;
  }
  if (typeof config === 'object' && config.id && PERSONAS[config.id]) {
    return PERSONAS[config.id];
  }
  return config;
}

function normalizeWorkerMessage(event) {
  const value = event?.data ?? event;
  return String(value ?? '').trim();
}

function parseInfoLine(line) {
  if (!line.startsWith('info ')) return null;

  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);

  let evalCp = null;
  let isMateScore = false;
  if (cpMatch) {
    evalCp = Number.parseInt(cpMatch[1], 10);
  } else if (mateMatch) {
    const mateIn = Number.parseInt(mateMatch[1], 10);
    evalCp = Math.sign(mateIn || 1) * MATE_SCORE_CP;
    isMateScore = true;
  }

  return {
    depth: depthMatch ? Number.parseInt(depthMatch[1], 10) : 0,
    evalCp,
    isMateScore,
    principalVariation: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
  };
}

function defaultWorkerFactory(workerUrl) {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is unavailable in this runtime. Provide workerFactory for tests/non-browser runtimes.');
  }
  return new Worker(workerUrl);
}

function defaultWorkerUrl() {
  return new URL('./vendor/stockfish/stockfish.js', import.meta.url);
}

export class StockfishWorkerClient {
  constructor({
    workerUrl = defaultWorkerUrl(),
    workerFactory = defaultWorkerFactory,
    analysisDepth = DEFAULT_ANALYSIS_DEPTH,
    playDepth = DEFAULT_PLAY_DEPTH,
    commandTimeoutMs = 15000,
    searchTimeoutMs = 30000,
  } = {}) {
    this.worker = workerFactory(workerUrl);
    this.analysisDepth = analysisDepth;
    this.playDepth = playDepth;
    this.commandTimeoutMs = commandTimeoutMs;
    this.searchTimeoutMs = searchTimeoutMs;
    this.waiters = [];
    this.currentSearch = null;
    this.queue = Promise.resolve();
    this.disposed = false;
    this.failure = null;
    this.readyPromise = null;
    this.engineName = null;
    this.engineAuthor = null;

    this.handleMessage = this.handleMessage.bind(this);
    this.handleError = this.handleError.bind(this);
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener?.('error', this.handleError);
  }

  handleError(event) {
    const error = event instanceof Error
      ? event
      : new Error(event?.message || 'Stockfish worker failed.');
    this.fail(error);
  }

  fail(error) {
    if (!this.failure) this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    if (this.currentSearch) {
      clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(this.failure);
      this.currentSearch = null;
    }
    this.worker.terminate?.();
  }

  handleMessage(event) {
    const line = normalizeWorkerMessage(event);
    if (!line) return;

    if (line.startsWith('id name ')) this.engineName = line.slice('id name '.length);
    if (line.startsWith('id author ')) this.engineAuthor = line.slice('id author '.length);

    for (let i = 0; i < this.waiters.length; i += 1) {
      const waiter = this.waiters[i];
      if (waiter.predicate(line)) {
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(line);
        break;
      }
    }

    if (!this.currentSearch) return;

    const info = parseInfoLine(line);
    if (info && info.depth >= this.currentSearch.depth) {
      this.currentSearch.depth = info.depth;
      if (info.evalCp !== null) {
        this.currentSearch.evalCp = info.evalCp;
        this.currentSearch.isMateScore = info.isMateScore;
      }
      if (info.principalVariation.length) {
        this.currentSearch.principalVariation = info.principalVariation;
      }
      return;
    }

    const bestMoveMatch = line.match(/^bestmove\s+(\S+)/);
    if (bestMoveMatch) {
      const search = this.currentSearch;
      this.currentSearch = null;
      clearTimeout(search.timer);
      const bestMove = bestMoveMatch[1] === '(none)' ? null : bestMoveMatch[1];
      search.resolve({
        bestMove,
        evalCp: search.evalCp,
        isMateScore: search.isMateScore,
        principalVariation: search.principalVariation,
      });
    }
  }

  waitFor(predicate, timeoutMs = this.commandTimeoutMs) {
    if (this.disposed) return Promise.reject(new Error('Stockfish worker has been disposed.'));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.fail(new Error(`Stockfish command timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  post(command) {
    if (this.disposed) throw new Error('Stockfish worker has been disposed.');
    if (this.failure) throw this.failure;
    this.worker.postMessage(command);
  }

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const uciOk = this.waitFor((line) => line === 'uciok');
        this.post('uci');
        await uciOk;
        await this.syncReady();
      })();
    }
    return this.readyPromise;
  }

  async syncReady() {
    const ready = this.waitFor((line) => line === 'readyok');
    this.post('isready');
    await ready;
  }

  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async search(fen, command) {
    if (this.currentSearch) {
      throw new Error('A Stockfish search is already active. Searches must be serialized.');
    }

    this.post(`position fen ${fen}`);
    const result = new Promise((resolve, reject) => {
      const search = {
        depth: -1,
        evalCp: null,
        isMateScore: false,
        principalVariation: [],
        resolve,
        reject,
        timer: null,
      };
      search.timer = setTimeout(() => {
        if (this.currentSearch !== search) return;
        this.fail(new Error(`Stockfish search timed out after ${this.searchTimeoutMs} ms.`));
      }, this.searchTimeoutMs);
      this.currentSearch = search;
    });
    this.post(command);
    return result;
  }

  analyzePosition(fen, depth = this.analysisDepth) {
    return this.enqueue(async () => {
      await this.ensureReady();
      this.post('setoption name UCI_LimitStrength value false');
      this.post('setoption name Skill Level value 20');
      await this.syncReady();
      return this.search(fen, `go depth ${Math.max(1, Math.trunc(depth))}`);
    });
  }

  playMove(fen, personaOrSkillLevel = 10) {
    return this.enqueue(async () => {
      await this.ensureReady();

      let targetDepth = this.playDepth;

      if (typeof personaOrSkillLevel === 'string' && PERSONAS[personaOrSkillLevel.toLowerCase().replace(/[-\s]/g, '_')]) {
        const p = resolvePersona(personaOrSkillLevel);
        targetDepth = p.depth ?? this.playDepth;
        if (p.uciLimitStrength && p.uciElo) {
          this.post('setoption name UCI_LimitStrength value true');
          this.post(`setoption name UCI_Elo value ${Math.trunc(p.uciElo)}`);
        } else {
          this.post('setoption name UCI_LimitStrength value false');
          this.post(`setoption name Skill Level value ${Math.trunc(p.skillLevel ?? 20)}`);
        }
      } else if (typeof personaOrSkillLevel === 'object' && personaOrSkillLevel !== null) {
        const p = personaOrSkillLevel;
        targetDepth = p.depth ?? this.playDepth;
        if (p.uciLimitStrength && p.uciElo) {
          this.post('setoption name UCI_LimitStrength value true');
          this.post(`setoption name UCI_Elo value ${Math.trunc(p.uciElo)}`);
        } else {
          this.post('setoption name UCI_LimitStrength value false');
          this.post(`setoption name Skill Level value ${Math.trunc(p.skillLevel ?? 20)}`);
        }
      } else {
        const strength = Number(personaOrSkillLevel);
        if (!Number.isFinite(strength)) {
          throw new TypeError('personaOrSkillLevel must be a persona name, object, or finite number.');
        }

        if (strength >= 0 && strength <= 20) {
          this.post('setoption name UCI_LimitStrength value false');
          this.post(`setoption name Skill Level value ${Math.trunc(strength)}`);
        } else {
          this.post('setoption name UCI_LimitStrength value true');
          this.post(`setoption name UCI_Elo value ${Math.trunc(strength)}`);
        }
      }
      await this.syncReady();

      const result = await this.search(fen, `go depth ${Math.max(1, Math.trunc(targetDepth))}`);
      return result.bestMove;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener?.('message', this.handleMessage);
    this.worker.removeEventListener?.('error', this.handleError);
    this.worker.terminate?.();

    const error = new Error('Stockfish worker disposed.');
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    if (this.currentSearch) {
      clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(error);
      this.currentSearch = null;
    }
  }
}

let singletonClient = null;

export function configureStockfish(options = {}) {
  singletonClient?.dispose();
  singletonClient = new StockfishWorkerClient(options);
  return singletonClient;
}

function getSingletonClient() {
  if (!singletonClient) singletonClient = new StockfishWorkerClient();
  return singletonClient;
}

export function analyzePosition(fen, depth) {
  return getSingletonClient().analyzePosition(fen, depth);
}

export function playMove(fen, skillLevel) {
  return getSingletonClient().playMove(fen, skillLevel);
}

export { parseInfoLine };
