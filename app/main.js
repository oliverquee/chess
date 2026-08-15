import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { ClaudeBackend, OllamaBackend } from '../analysis/backends.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { createNodeWorker } from '../engine/nodeWorkerAdapter.js';
import { StockfishWorkerClient } from '../engine/stockfishWorker.js';
import { initDb } from '../storage/db.js';
import { AppController } from './controller.js';
import { registerIpcHandlers } from './ipc.js';
import { SecretStore } from './secretStore.js';
import { isAllowedChessComUrl, remoteThemeWebPreferences, secureWebPreferences } from './security.js';

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
let runtime = null;
let mainWindow = null;
let themeWindow = null;

function engineFactory() {
  return new StockfishWorkerClient({
    workerUrl: new URL('../engine/vendor/stockfish/stockfish.js', import.meta.url),
    workerFactory: createNodeWorker,
    analysisDepth: 10,
    playDepth: 8,
  });
}

function createRuntime() {
  const userData = app.getPath('userData');
  const db = initDb(join(userData, 'history.sqlite'));
  const puzzleDb = initPuzzleDb(process.env.CHESS_PUZZLE_DB_PATH ?? join(userData, 'lichess-puzzles.sqlite'));
  const secretStore = new SecretStore({ safeStorage, path: join(userData, 'secrets.json') });
  const orchestrator = new TrainingOrchestrator({
    db,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory,
  });
  const backendFactory = ({ backend, model, claudeApiKey }) => {
    if (backend === 'claude') {
      if (!claudeApiKey) throw new Error('No Claude API key is stored.');
      return new ClaudeBackend({ apiKey: claudeApiKey, model });
    }
    if (backend === 'ollama') return new OllamaBackend({ model });
    throw new RangeError(`Unsupported backend: ${backend}`);
  };
  const controller = new AppController({ db, orchestrator, engineFactory, backendFactory, secretStore });
  return {
    db,
    puzzleDb,
    orchestrator,
    controller,
    close() {
      for (const session of orchestrator.sessions.values()) session.engine.dispose?.();
      puzzleDb.close();
      db.close();
    },
  };
}

function hardenLocalWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function openChessComTheme() {
  if (themeWindow && !themeWindow.isDestroyed()) {
    themeWindow.focus();
    return { opened: true };
  }
  themeWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Chess.com — visual theme only',
    webPreferences: remoteThemeWebPreferences(),
  });
  themeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  themeWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  themeWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedChessComUrl(url)) event.preventDefault();
  });
  themeWindow.webContents.on('did-finish-load', () => {
    const css = readFileSync(join(APP_DIR, 'chesscom-theme.css'), 'utf8');
    themeWindow?.webContents.insertCSS(css).catch(() => {});
  });
  themeWindow.on('closed', () => { themeWindow = null; });
  themeWindow.loadURL('https://www.chess.com/play/online').catch(() => {});
  return { opened: true };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: 'Chess Analyst',
    backgroundColor: '#f4efe5',
    webPreferences: secureWebPreferences(join(APP_DIR, 'preload.cjs')),
  });
  hardenLocalWindow(mainWindow);
  let preloadFailed = null;
  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => {
    preloadFailed = error.message;
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (process.env.CHESS_ANALYST_SMOKE === '1') {
      const preferences = mainWindow.webContents.getLastWebPreferences();
      console.log(`CHESS_ANALYST_SMOKE:${JSON.stringify({
        loaded: true,
        preloadFailed,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        sandbox: preferences.sandbox,
      })}`);
      app.quit();
    }
  });
  mainWindow.loadFile(join(APP_DIR, 'index.html'));
}

app.whenReady().then(() => {
  runtime = createRuntime();
  registerIpcHandlers({ ipcMain, controller: runtime.controller, openChessComTheme });
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  runtime?.close();
  runtime = null;
});
