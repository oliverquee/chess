import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort, isMainThread } from 'node:worker_threads';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const StockfishFactory = require('./vendor/stockfish/stockfish.js')();
const wasmPath = resolve(__dirname, './vendor/stockfish/stockfish.wasm');

export class NodeStockfish {
  constructor() {
    this.ready = false;
    this.currentSearch = null;
    this.instance = null;
  }

  async init() {
    const wasmWrapper = {
      locateFile: (p) => p.endsWith('.wasm') ? wasmPath : p,
      listener: (line) => this.onLine(line),
    };
    this.instance = await StockfishFactory(wasmWrapper);
    this.cmd('uci');
    this.cmd('isready');
    this.ready = true;
  }

  cmd(command) {
    if (!this.instance) throw new Error('Stockfish not initialized');
    this.instance.ccall('command', null, ['string'], [command]);
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
        this.currentSearch.evalCp = Math.sign(parseInt(mateMatch[1], 10) || 1) * 100000;
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
      this.cmd('position fen ' + fen);
      this.cmd('go depth ' + depth);
    });
  }

  dispose() {
    try {
      this.cmd('quit');
    } catch {}
  }
}

// If invoked as a worker thread
if (!isMainThread && parentPort) {
  const engine = new NodeStockfish();
  engine.init().then(() => {
    parentPort.postMessage({ type: 'ready' });

    parentPort.on('message', async (msg) => {
      if (msg.type === 'analyze') {
        const { id, fen, depth } = msg;
        try {
          const result = await engine.analyze(fen, depth || 16);
          parentPort.postMessage({ type: 'result', id, result });
        } catch (err) {
          parentPort.postMessage({ type: 'error', id, error: err.message });
        }
      } else if (msg.type === 'quit') {
        engine.dispose();
        process.exit(0);
      }
    });
  }).catch((err) => {
    parentPort.postMessage({ type: 'fatal', error: err.message });
  });
}

