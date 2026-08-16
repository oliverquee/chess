import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInfoLine, StockfishWorkerClient } from '../engine/stockfishWorker.js';

class FakeWorker {
  constructor() {
    this.listeners = new Set();
    this.commands = [];
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  emit(data) {
    queueMicrotask(() => {
      for (const listener of this.listeners) listener({ data });
    });
  }

  postMessage(command) {
    this.commands.push(command);
    if (command === 'uci') this.emit('uciok');
    if (command === 'isready') this.emit('readyok');
    if (command.startsWith('go depth')) {
      this.emit('info depth 8 score cp 34 pv e2e4 e7e5 g1f3');
      this.emit('bestmove e2e4');
    }
  }

  terminate() {}
}

test('Stockfish worker client parses bestmove, centipawn eval and PV asynchronously', async () => {
  const fake = new FakeWorker();
  const client = new StockfishWorkerClient({ workerFactory: () => fake, workerUrl: 'local-stockfish.js' });
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const result = await client.analyzePosition(fen, 8);
  assert.deepEqual(result, {
    bestMove: 'e2e4',
    evalCp: 34,
    isMateScore: false,
    principalVariation: ['e2e4', 'e7e5', 'g1f3'],
  });
  assert.ok(fake.commands.includes(`position fen ${fen}`));
  assert.ok(fake.commands.includes('go depth 8'));
  client.dispose();
});

test('mate UCI scores are flagged instead of looking like ordinary centipawns', () => {
  assert.deepEqual(
    parseInfoLine('info depth 18 score mate -3 pv g8h8 h5h7'),
    {
      depth: 18,
      evalCp: -100000,
      isMateScore: true,
      principalVariation: ['g8h8', 'h5h7'],
    },
  );
});

test('a real dependency that stops responding fails by timeout instead of hanging', async () => {
  class SilentSearchWorker extends FakeWorker {
    postMessage(command) {
      this.commands.push(command);
      if (command === 'uci') this.emit('uciok');
      if (command === 'isready') this.emit('readyok');
    }
  }

  const client = new StockfishWorkerClient({
    workerFactory: () => new SilentSearchWorker(),
    workerUrl: 'silent-stockfish.js',
    commandTimeoutMs: 50,
    searchTimeoutMs: 20,
  });

  try {
    await assert.rejects(
      () => client.analyzePosition('8/8/8/8/8/8/4k3/4K3 w - - 0 1', 1),
      /search timed out after 20 ms/,
    );
  } finally {
    client.dispose();
  }
});
