import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/**
 * Web Worker-shaped adapter backed by Stockfish.js's supported Node CLI. It is
 * used by headless scripts/tests; Electron renderer code uses a native browser
 * Worker with the same vendored JS/WASM pair.
 */
export class NodeWorkerAdapter {
  constructor(workerUrl) {
    this.listeners = { message: new Set(), error: new Set() };
    this.process = spawn(process.execPath, [fileURLToPath(workerUrl)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on('line', (data) => this.emit('message', { data }));
    this.process.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit('error', new Error(message));
    });
    this.process.on('error', (error) => this.emit('error', error));
    this.process.on('exit', (code, signal) => {
      if (code && code !== 0) {
        this.emit('error', new Error(`Stockfish process exited with code ${code}${signal ? ` (${signal})` : ''}.`));
      }
    });
  }

  emit(type, event) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  addEventListener(type, listener) {
    this.listeners[type]?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  postMessage(command) {
    this.process.stdin.write(`${command}\n`);
  }

  terminate() {
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }
}

export function createNodeWorker(workerUrl) {
  return new NodeWorkerAdapter(workerUrl);
}
