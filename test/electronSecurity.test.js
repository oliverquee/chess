import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IPC_CHANNELS, isAllowedChessComUrl, remoteThemeWebPreferences, secureWebPreferences } from '../app/security.js';
import { isTrustedIpcEvent, registerIpcHandlers } from '../app/ipc.js';

test('local and remote Electron web preferences enforce isolation and disable Node', () => {
  assert.deepEqual(secureWebPreferences('/trusted/preload.cjs'), {
    preload: '/trusted/preload.cjs',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
  assert.deepEqual(remoteThemeWebPreferences(), {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: 'persist:chesscom-theme',
  });
  assert.equal('preload' in remoteThemeWebPreferences(), false);
});

test('remote theme navigation accepts HTTPS chess.com only', () => {
  assert.equal(isAllowedChessComUrl('https://www.chess.com/play/online'), true);
  assert.equal(isAllowedChessComUrl('https://support.chess.com/article'), true);
  assert.equal(isAllowedChessComUrl('http://www.chess.com/play'), false);
  assert.equal(isAllowedChessComUrl('https://chess.com.attacker.example'), false);
  assert.equal(isAllowedChessComUrl('javascript:alert(1)'), false);
});

test('IPC registers exactly the explicit allowlist and removes it cleanly', () => {
  const registered = new Map();
  const removed = [];
  const ipcMain = {
    handle(channel, handler) { registered.set(channel, handler); },
    removeHandler(channel) { removed.push(channel); },
  };
  const controller = new Proxy({}, { get: () => () => ({ ok: true }) });
  const unregister = registerIpcHandlers({ ipcMain, controller, openChessComTheme: () => ({ opened: true }) });
  assert.deepEqual([...registered.keys()].sort(), Object.values(IPC_CHANNELS).sort());
  unregister();
  assert.deepEqual(removed.sort(), Object.values(IPC_CHANNELS).sort());
});

test('IPC accepts the local file renderer and rejects remote renderers', () => {
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: 'file:///app/index.html' } }), true);
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: 'https://www.chess.com/play' } }), false);
  const registered = new Map();
  const ipcMain = { handle: (channel, handler) => registered.set(channel, handler), removeHandler() {} };
  registerIpcHandlers({
    ipcMain,
    controller: new Proxy({}, { get: () => () => ({ ok: true }) }),
    openChessComTheme: () => ({ opened: true }),
  });
  assert.throws(
    () => registered.get(IPC_CHANNELS.getState)({ senderFrame: { url: 'https://www.chess.com/' } }),
    /untrusted renderer/,
  );
  assert.deepEqual(
    registered.get(IPC_CHANNELS.getState)({ senderFrame: { url: 'file:///app/index.html' } }),
    { ok: true },
  );
});

test('preload exposes no filesystem, SQLite, process, or secret-read primitive', () => {
  const preload = readFileSync(new URL('../app/preload.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(preload, /require\(['"](?:fs|node:fs|sqlite|node:sqlite|child_process|node:child_process)['"]\)/);
  assert.doesNotMatch(preload, /process\.|getClaudeKey|decrypt/);
  for (const channel of Object.values(IPC_CHANNELS)) assert.match(preload, new RegExp(channel.replaceAll(':', '\\:')));
});

test('chess.com window code uses CSS injection and has no DOM/state extraction mechanism', () => {
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  assert.match(main, /insertCSS/);
  assert.doesNotMatch(main, /executeJavaScript|querySelector|capturePage|debugger\.|sendInputEvent/);
  const renderer = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(renderer, /require\(|process\.|fetch\(/);
});
