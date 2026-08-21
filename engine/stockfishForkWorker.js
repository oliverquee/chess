import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const StockfishFactory = require('./vendor/stockfish/stockfish.js')();
const wasmPath = resolve(__dirname, './vendor/stockfish/stockfish.wasm');

class StockfishForkWorker {
  constructor() {
    this.currentSearch = null;
    this.instance = null;
  }

  async init() {
    this.instance = await StockfishFactory({
      locateFile: (p) => (p.endsWith('.wasm') ? wasmPath : p),
      listener: (line) => this.onLine(line),
    });
    this.instance.ccall('command', null, ['string'], ['uci']);
    this.instance.ccall('command', null, ['string'], ['isready']);
  }

  onLine(line) {
    if (!this.currentSearch) return;

    if (line.startsWith('info depth 8 ') && !this.currentSearch.bestMoveDepth8) {
      const pvMatch = line.match(/\bpv\s+(\S+)/);
      if (pvMatch) this.currentSearch.bestMoveDepth8 = pvMatch[1];
    }

    if (line.startsWith('info depth ')) {
      const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
      const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
      const pvMatch = line.match(/\bpv\s+(.+)$/);
      if (cpMatch) {
        this.currentSearch.evalCp = parseInt(cpMatch[1], 10);
        this.currentSearch.isMateScore = 0;
      } else if (mateMatch) {
        const mateIn = parseInt(mateMatch[1], 10) || 1;
        this.currentSearch.evalCp = Math.sign(mateIn) * 100000;
        this.currentSearch.isMateScore = 1;
      }
      if (pvMatch) {
        this.currentSearch.pv = pvMatch[1].trim();
      }
    }

    const bmMatch = line.match(/^bestmove\s+(\S+)/);
    if (bmMatch) {
      const resolve = this.currentSearch.resolve;
      const bm = bmMatch[1] === '(none)' ? null : bmMatch[1];
      const result = {
        bestMove: bm,
        bestMoveDepth8: this.currentSearch.bestMoveDepth8 || bm,
        evalCp: this.currentSearch.evalCp,
        isMateScore: this.currentSearch.isMateScore,
        principalVariation: this.currentSearch.pv,
      };
      this.currentSearch = null;
      resolve(result);
    }
  }

  analyze(fen, depth = 16) {
    return new Promise((resolve) => {
      this.currentSearch = {
        resolve,
        evalCp: 0,
        isMateScore: 0,
        bestMoveDepth8: null,
        pv: null,
      };
      this.instance.ccall('command', null, ['string'], ['position fen ' + fen]);
      this.instance.ccall('command', null, ['string'], ['go depth ' + depth]);
    });
  }
}

const engine = new StockfishForkWorker();
engine.init().then(() => {
  if (process.send) process.send({ type: 'ready' });

  process.on('message', async (msg) => {
    if (msg.type === 'analyze') {
      try {
        const result = await engine.analyze(msg.fen, msg.depth || 16);
        process.send({ type: 'result', id: msg.id, result });
      } catch (err) {
        process.send({ type: 'error', id: msg.id, error: err.message });
      }
    } else if (msg.type === 'quit') {
      process.exit(0);
    }
  });
}).catch((err) => {
  if (process.send) process.send({ type: 'fatal', error: err.message });
  process.exit(1);
});

