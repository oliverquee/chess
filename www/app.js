/**
 * Chess Analyst — Orange Cat Edition
 * Mobile practice board, wired to the REAL verified modules.
 *
 * This replaces the previous standalone prototype, which reimplemented chess
 * rules by hand and stored sessions in memory. Everything below routes through
 * the tested code:
 *   - legality/FEN   -> chess.js
 *   - training loop  -> core/orchestrator.js
 *   - persistence    -> storage/mobileDb.js       (Capacitor SQLite)
 *   - seed puzzles   -> storage/mobilePuzzleDb.js (real corpus)
 *   - engine         -> engine/stockfishWorker.js (Stockfish 18 Lite WASM)
 *
 * NOTE: bundled by scripts/buildWeb.js into www/bundle.js. index.html loads the
 * bundle, not this file, because Capacitor ships only webDir (www/) into the
 * APK — imports outside www/ must be inlined at build time.
 */

import { Chess } from 'chess.js';
import { CloseAction, InAppBrowser, ToolBarType } from '@capgo/capacitor-inappbrowser';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import { CORPUS_MANIFEST } from '../data/corpusManifest.js';
import { configureStockfish, StockfishWorkerClient } from '../engine/stockfishWorker.js';
import * as mobileStorage from '../storage/mobileDb.js';
import { MobileSqlitePuzzleLibrary } from '../storage/mobilePuzzleDb.js';
import { downloadAndImportCorpus, getCorpusStatus } from '../storage/corpusBootstrap.js';
import { engineDifficultyLabel, renderProfile } from './profile.js';
import chessComThemeCss from './chesscom-theme.css';
import { createChessComView } from './chesscomView.js';
import { applyAppTheme, chessComCssForTheme, getTheme } from './themes.js';

const PIECES = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

const ENGINE_TIMEOUT_MS = 15000;
const ENGINE_DEPTH = 12;
const DB_NAME = 'chess_analyst';

/* ---------------------------------------------------------------- *
 * DOM handles
 * ---------------------------------------------------------------- */
const el = (id) => document.getElementById(id);
const boardEl = el('chessboard');
const moveLogEl = el('move-log');
const pvMovesEl = el('pv-moves');
const engineEvalEl = el('engine-eval');
const moveStatusEl = el('move-status');
const turnIndicatorEl = el('turn-indicator');
const systemStatusEl = el('system-status');
const targetNameEl = el('target-name');
const targetDescEl = el('target-desc');
const queueIndicatorEl = el('target-queue-indicator');
const sessionBadgeEl = el('session-badge');

/* ---------------------------------------------------------------- *
 * App state
 * ---------------------------------------------------------------- */
let db = null;
let orchestrator = null;
let engineClient = null;
let chess = new Chess();
let activeSession = null;
let selectedSquare = null;
let boardFlipped = true;
let isEngineThinking = false;
let engineTimeoutHandle = null;
let settings = null;
let corpusStatus = { populated: false, puzzleCount: 0, version: null };
const chessComView = createChessComView({
  inAppBrowser: InAppBrowser,
  themeCss: chessComThemeCss,
  browserOptions: {
    toolbarType: ToolBarType.NAVIGATION,
    title: 'Chess.com • Cat Theme',
    backgroundColor: 'white',
    activeNativeNavigationForWebview: true,
    showReloadButton: true,
    closeAction: CloseAction.HIDE,
    enabledSafeTopMargin: true,
  },
});

/* ---------------------------------------------------------------- *
 * Status helpers
 * ---------------------------------------------------------------- */
function setStatus(text) {
  if (systemStatusEl) systemStatusEl.textContent = `${text} • ${getTheme(settings?.theme).label} Theme`;
}

async function activateTheme(themeId) {
  const theme = applyAppTheme(themeId);
  await chessComView.setThemeCss(chessComCssForTheme(chessComThemeCss, themeId));
  return theme;
}
function setMoveStatus(text) {
  if (moveStatusEl) moveStatusEl.textContent = text;
}
function setFatal(message, err) {
  console.error(message, err);
  setStatus('Startup problem');
  setMoveStatus(message);
}

/* ---------------------------------------------------------------- *
 * Engine
 *
 * The vendored loader resolves its .wasm relative to self.location, which
 * breaks under the capacitor:// scheme. Passing an explicit absolute URL
 * makes the worker find stockfish.wasm regardless of scheme.
 * ---------------------------------------------------------------- */
function stockfishWorkerUrl() {
  return new URL('./vendor/stockfish/stockfish.js', document.baseURI).href;
}

async function initEngine() {
  const workerUrl = stockfishWorkerUrl();
  configureStockfish({ workerUrl });
  engineClient = new StockfishWorkerClient({ workerUrl });

  if (typeof engineClient.onInfo === 'function') {
    engineClient.onInfo(handleInfoLine);
  } else if (engineClient.worker?.addEventListener) {
    engineClient.worker.addEventListener('message', (event) => {
      const line = typeof event.data === 'string' ? event.data : event.data?.data;
      if (typeof line === 'string') handleInfoLine(line);
    });
  }
  setStatus('Stockfish 18 Lite WASM active');
}

function handleInfoLine(line) {
  if (typeof line !== 'string' || !line.startsWith('info ')) return;
  const cp = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mate = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pv = line.match(/\bpv\s+(.+)$/);
  if (mate && engineEvalEl) {
    engineEvalEl.textContent = `Eval: M${mate[1]}`;
  } else if (cp && engineEvalEl) {
    const score = (parseInt(cp[1], 10) / 100).toFixed(2);
    engineEvalEl.textContent = `Eval: ${Number(score) > 0 ? '+' : ''}${score}`;
  }
  if (pv && pvMovesEl) pvMovesEl.textContent = pv[1];
}

/** Resolves to null on timeout instead of hanging forever. */
function withTimeout(promise, ms) {
  let handle;
  const timeout = new Promise((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

/* ---------------------------------------------------------------- *
 * Board rendering — legality always from chess.js, never hand-rolled
 * ---------------------------------------------------------------- */
function squareName(fileIdx, rankIdx) {
  return `${String.fromCharCode(97 + fileIdx)}${8 - rankIdx}`;
}

function legalTargetsFrom(square) {
  try {
    return chess.moves({ square, verbose: true }).map((m) => m.to);
  } catch (err) {
    return [];
  }
}

function renderBoard() {
  if (!boardEl) return;
  boardEl.innerHTML = '';
  const board = chess.board();
  const targets = selectedSquare ? legalTargetsFrom(selectedSquare) : [];
  const inCheck = typeof chess.inCheck === 'function' ? chess.inCheck() : false;

  const rankOrder = boardFlipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const fileOrder = boardFlipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  for (const r of rankOrder) {
    for (const f of fileOrder) {
      const sq = squareName(f, r);
      const piece = board[r][f];
      const div = document.createElement('div');
      const isLight = (r + f) % 2 === 0;
      div.className = `square ${isLight ? 'light' : 'dark'}`;
      div.dataset.square = sq;

      if (sq === selectedSquare) div.classList.add('selected');
      if (targets.includes(sq)) {
        div.classList.add('legal-target');
        if (piece) div.classList.add('has-piece');
      }
      if (inCheck && piece && piece.type === 'k' && piece.color === chess.turn()) {
        div.classList.add('in-check');
      }

      if (piece) {
        const span = document.createElement('span');
        span.textContent = piece.color === 'w'
          ? PIECES[piece.type.toUpperCase()]
          : PIECES[piece.type];
        span.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        div.appendChild(span);
      }

      div.addEventListener('click', () => handleSquareClick(sq));
      boardEl.appendChild(div);
    }
  }
  updateTurnUI();
}

function updateTurnUI() {
  if (!turnIndicatorEl) return;
  if (chess.isGameOver?.()) {
    let reason = 'Game over';
    if (chess.isCheckmate?.()) reason = 'Checkmate!';
    else if (chess.isStalemate?.()) reason = 'Stalemate';
    else if (chess.isDraw?.()) reason = 'Draw';
    turnIndicatorEl.textContent = reason;
    return;
  }
  const mine = chess.turn() === (boardFlipped ? 'b' : 'w');
  turnIndicatorEl.textContent = mine ? 'Your turn to pounce!' : 'Stockfish is thinking…';
}

function appendLog(ply, san) {
  if (!moveLogEl) return;
  const empty = moveLogEl.querySelector('.empty-log-message');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-ply">${ply}.</span> <span class="log-move">${san}</span>`;
  moveLogEl.appendChild(div);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

/* ---------------------------------------------------------------- *
 * Move handling
 * ---------------------------------------------------------------- */
async function handleSquareClick(square) {
  if (!activeSession) {
    setMoveStatus('Start a session first — tap "Pounce on Weakness".');
    return;
  }
  if (isEngineThinking) return;
  if (chess.isGameOver?.()) return;

  const piece = chess.get(square);

  if (selectedSquare) {
    if (legalTargetsFrom(selectedSquare).includes(square)) {
      await playPlayerMove(selectedSquare, square);
      return;
    }
    selectedSquare = piece && piece.color === chess.turn() ? square : null;
    renderBoard();
    return;
  }

  if (piece && piece.color === chess.turn()) {
    selectedSquare = square;
    setMoveStatus(`Target selected: ${square}`);
    renderBoard();
  }
}

async function playPlayerMove(from, to) {
  // chess.js is the sole authority on legality.
  let move = null;
  try {
    move = chess.move({ from, to, promotion: 'q' });
  } catch (err) {
    move = null;
  }
  if (!move) {
    setMoveStatus('That move is not legal.');
    selectedSquare = null;
    renderBoard();
    return;
  }

  selectedSquare = null;
  appendLog(Math.ceil(chess.history().length / 2), move.san);
  renderBoard();

  const uci = move.from + move.to + (move.promotion ?? '');

  // PracticeSession.playTurn() logs the player move AND plays the engine's
  // reply itself. We must NOT run a second search here — doing so would move
  // twice and desync the board from session.currentFen.
  isEngineThinking = true;
  setMoveStatus('Orange Cat Stockfish is calculating…');
  updateTurnUI();

  let result = null;
  try {
    result = await withTimeout(activeSession.playTurn(uci), ENGINE_TIMEOUT_MS);
  } catch (err) {
    console.error('playTurn failed', err);
    setMoveStatus('Engine hiccup — your move stands, try again.');
  } finally {
    isEngineThinking = false;
  }

  if (!result) {
    setMoveStatus('Engine did not reply in time. Tap a piece to try again.');
    renderBoard();
    return;
  }

  const engineMove = result.engineLog?.move_played;
  if (engineMove) {
    try {
      const applied = chess.move({
        from: engineMove.slice(0, 2),
        to: engineMove.slice(2, 4),
        promotion: engineMove.length > 4 ? engineMove[4] : undefined,
      });
      if (applied) appendLog(Math.ceil(chess.history().length / 2), applied.san);
    } catch (err) {
      console.error('Could not apply engine move locally', err);
    }
  }

  // Session state is authoritative; resync if we drifted for any reason.
  if (result.currentFen && chess.fen() !== result.currentFen) {
    chess = new Chess(result.currentFen);
  }

  setMoveStatus(chess.isGameOver?.() ? 'Game over — tap "End Session" to save.' : 'Your move.');
  renderBoard();
}

/* ---------------------------------------------------------------- *
 * Session lifecycle — driven by the real orchestrator
 * ---------------------------------------------------------------- */
function syncSessionToBoard(session) {
  activeSession = session;
  const fen = session?.currentFen ?? session?.startFen;
  chess = fen ? new Chess(fen) : new Chess();
  boardFlipped = chess.turn() === 'b';
  selectedSquare = null;
  if (moveLogEl) {
    moveLogEl.innerHTML = '<div class="empty-log-message">Motif-ready position loaded. Your move!</div>';
  }
  renderBoard();
}

async function startTargetedSession() {
  try {
    setMoveStatus('Finding your weakest spot…');
    const focus = await orchestrator.startTargetedSession();

    if (!focus.weaknessCategory || !focus.activeSession) {
      setMoveStatus(focus.advice ?? 'No seedable weakness yet — play a few games first.');
      return;
    }
    if (targetNameEl) targetNameEl.textContent = `${focus.weaknessCategory.replace(/_/g, ' ')} motifs`;
    if (targetDescEl) targetDescEl.textContent = `Start-slow: ${focus.queued.length} seed puzzles queued`;
    if (queueIndicatorEl) queueIndicatorEl.textContent = `Seed 1 of ${focus.queued.length}`;
    if (sessionBadgeEl) sessionBadgeEl.textContent = 'Practice Mode';

    syncSessionToBoard(focus.activeSession);
    setMoveStatus('Session started. Pounce!');
  } catch (err) {
    setFatal('Could not start a session.', err);
  }
}

async function startNextQueued() {
  try {
    const next = await orchestrator.startNextQueuedSession();
    if (!next) {
      setMoveStatus('No more seeds queued — start a new hunt.');
      return;
    }
    if (queueIndicatorEl) queueIndicatorEl.textContent = 'Seed 2 of 2';
    syncSessionToBoard(next);
    setMoveStatus('Second seed loaded.');
  } catch (err) {
    setFatal('Could not load the next seed.', err);
  }
}

async function completeSession() {
  if (!activeSession) {
    setMoveStatus('No active session to save.');
    return;
  }
  if (!window.confirm('End this session and save it?')) return;
  try {
    await orchestrator.completeSession(activeSession);
    activeSession = null;
    setMoveStatus('Session saved to your history.');
    if (sessionBadgeEl) sessionBadgeEl.textContent = 'Saved';

    const focus = await orchestrator.getNextFocus();
    if (targetNameEl && focus?.weaknessCategory) {
      targetNameEl.textContent = `${focus.weaknessCategory.replace(/_/g, ' ')} motifs`;
      if (targetDescEl) targetDescEl.textContent = 'Next focus ready';
    }
  } catch (err) {
    setFatal('Could not save the session.', err);
  }
}

/* ---------------------------------------------------------------- *
 * M9 corpus bootstrap, profile, settings, and primary navigation
 * ---------------------------------------------------------------- */
function showPage(page) {
  const profile = page === 'profile';
  el('practice-page')?.classList.toggle('hidden', profile);
  el('profile-page')?.classList.toggle('hidden', !profile);
  el('nav-practice')?.classList.toggle('active', !profile);
  el('nav-profile')?.classList.toggle('active', profile);
  if (profile) void refreshProfile();
}

async function openChessCom() {
  setStatus('Opening themed Chess.com');
  try {
    await chessComView.open();
    setStatus('Chess.com theme active');
  } catch (error) {
    console.error('Could not open embedded Chess.com', error);
    setStatus('Chess.com could not open');
    setMoveStatus('Embedded Chess.com failed to open. Check the connection and try again.');
  }
}

function setCorpusProgress({ phase, percent }) {
  const progress = el('corpus-progress');
  const label = el('corpus-progress-label');
  progress?.classList.remove('hidden');
  if (progress && Number.isFinite(percent)) progress.value = percent;
  if (label) {
    const action = phase === 'import' ? 'Importing puzzles' : phase === 'verify' ? 'Verifying download' : 'Downloading puzzle pack';
    label.textContent = Number.isFinite(percent) ? `${action}… ${percent}%` : `${action}…`;
  }
}

async function importCorpus({ force = false } = {}) {
  const button = el('btn-download-corpus');
  if (!CORPUS_MANIFEST.url || !CORPUS_MANIFEST.sha256) {
    throw new Error('The M9 corpus release asset has not been published yet.');
  }
  if (button) button.disabled = true;
  try {
    corpusStatus = await downloadAndImportCorpus({
      db,
      manifest: CORPUS_MANIFEST,
      force,
      onProgress: setCorpusProgress,
    });
    el('corpus-first-run')?.classList.add('hidden');
    if (el('corpus-progress-label')) el('corpus-progress-label').textContent = `${corpusStatus.puzzleCount.toLocaleString()} puzzles ready.`;
    if (!orchestrator) await initializePractice();
    await refreshProfile();
    setStatus('Ready');
  } catch (error) {
    console.error('Corpus import failed', error);
    if (el('corpus-progress-label')) el('corpus-progress-label').textContent = `${error.message} Check your connection and try again.`;
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshProfile() {
  if (!db) return;
  settings = await mobileStorage.getSettings(db);
  await activateTheme(settings.theme);
  const stats = await mobileStorage.getProfileStats(db);
  corpusStatus = await getCorpusStatus(db);
  let focus = null;
  if (orchestrator && corpusStatus.populated) {
    try { focus = await orchestrator.getNextFocus(); } catch (error) { console.warn('Could not resolve profile focus', error); }
  }
  const container = el('profile-page');
  renderProfile({ container, stats, settings, corpusStatus, focus });

  const range = container.querySelector('[name="engine_skill_level"]');
  range?.addEventListener('input', () => {
    const output = el('engine-level-output');
    const label = el('engine-difficulty-label');
    if (output) output.textContent = range.value;
    if (label) label.textContent = engineDifficultyLabel(range.value);
  });
  el('settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    for (const key of ['display_name', 'cat_avatar', 'chesscom_username', 'engine_skill_level', 'theme']) {
      await mobileStorage.setSetting(db, key, form.get(key));
    }
    settings = await mobileStorage.getSettings(db);
    await activateTheme(settings.theme);
    orchestrator?.setSkillLevel(Number(settings.engine_skill_level));
    const display = el('engine-skill-display');
    if (display) display.textContent = `Engine Skill: ${settings.engine_skill_level}`;
    setStatus('Settings saved');
    await refreshProfile();
  });
  el('btn-corpus-update')?.addEventListener('click', () => importCorpus({ force: true }).catch(() => {}));
  el('btn-reset-data')?.addEventListener('click', async () => {
    if (!window.confirm('Delete all sessions, move history, weakness data, and settings? This cannot be undone.')) return;
    await mobileStorage.resetUserData(db);
    activeSession = null;
    setStatus('Training data reset');
    await refreshProfile();
  });
}

async function initializePractice() {
  const puzzleLibrary = new MobileSqlitePuzzleLibrary(db);
  await initEngine();
  settings = await mobileStorage.getSettings(db);
  orchestrator = new TrainingOrchestrator({
    db,
    storage: mobileStorage,
    puzzleLibrary,
    engineFactory: () => engineClient,
    skillLevel: Number(settings.engine_skill_level),
  });
  const display = el('engine-skill-display');
  if (display) display.textContent = `Engine Skill: ${settings.engine_skill_level}`;
  chess = new Chess();
  renderBoard();
  setStatus('Ready');
  setMoveStatus('Tap "Pounce on Weakness" to begin.');
}

/* ---------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------- */
async function boot() {
  setStatus('Waking the cat…');

  try {
    db = await mobileStorage.initDb(DB_NAME);
  } catch (err) {
    setFatal('Could not open local storage. Sessions will not be saved.', err);
    return;
  }

  try {
    corpusStatus = await getCorpusStatus(db);
    settings = await mobileStorage.getSettings(db);
  } catch (err) {
    setFatal('Could not inspect local app data.', err);
    return;
  }

  if (corpusStatus.populated) {
    try {
      await initializePractice();
    } catch (err) {
      setFatal('Stockfish or the puzzle library failed to start.', err);
      return;
    }
  } else {
    chess = new Chess();
    renderBoard();
    el('corpus-first-run')?.classList.remove('hidden');
    setStatus('Puzzle pack needed');
    setMoveStatus('Download the one-time puzzle pack to begin.');
  }

  el('btn-start-target')?.addEventListener('click', startTargetedSession);
  el('btn-next-queued')?.addEventListener('click', startNextQueued);
  el('btn-complete')?.addEventListener('click', completeSession);
  el('btn-download-corpus')?.addEventListener('click', () => importCorpus().catch(() => {}));
  el('nav-practice')?.addEventListener('click', () => showPage('practice'));
  el('nav-profile')?.addEventListener('click', () => showPage('profile'));
  el('nav-chesscom')?.addEventListener('click', () => { void openChessCom(); });
  el('btn-flip')?.addEventListener('click', () => {
    boardFlipped = !boardFlipped;
    renderBoard();
  });

  el('tab-moves')?.addEventListener('click', () => {
    el('tab-content-moves')?.classList.remove('hidden');
    el('tab-content-preview')?.classList.add('hidden');
    el('tab-moves')?.classList.add('active');
    el('tab-preview')?.classList.remove('active');
  });
  el('tab-preview')?.addEventListener('click', () => {
    el('tab-content-preview')?.classList.remove('hidden');
    el('tab-content-moves')?.classList.add('hidden');
    el('tab-preview')?.classList.add('active');
    el('tab-moves')?.classList.remove('active');
  });

  await refreshProfile();
}

document.addEventListener('DOMContentLoaded', boot);
