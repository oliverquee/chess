/**
 * Chess Analyst — Orange Cat Edition (Milestone M10)
 * Mobile practice board, wired to verified engines, dual-DB storage,
 * progressive hints, drift-proof clocks, streaks, scoring and personas.
 */

import { Chess } from 'chess.js';
import { CloseAction, InAppBrowser, ToolBarType } from '@capgo/capacitor-inappbrowser';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import { CORPUS_MANIFEST } from '../data/corpusManifest.js';
import { configureStockfish, StockfishWorkerClient, PERSONAS, resolvePersona } from '../engine/stockfishWorker.js';
import { ChessClock, STANDARD_TIME_CONTROLS, formatClockTime } from '../engine/clock.js';
import { PracticeSession } from '../engine/practiceSession.js';
import { computeEvalBarState } from '../engine/evalBar.js';
import { checkBlunderCandidate, generateHint } from '../engine/hints.js';
import { calculateSeedScore } from '../core/scoring.js';
import { calculateDailyProgress, processDailyStreakUpdate, advanceCategoryMastery } from '../core/streaks.js';
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
const opponentAvatarEl = el('opponent-avatar');
const opponentNameEl = el('opponent-name');
const opponentClockEl = el('opponent-clock');
const userClockEl = el('user-clock');
const evalBarFillEl = el('eval-bar-fill');

/* ---------------------------------------------------------------- *
 * App state
 * ---------------------------------------------------------------- */
let db = null;
let orchestrator = null;
let engineClient = null;
let chess = new Chess();
let activeSession = null;
let sessionClock = null;
let clockIntervalHandle = null;
let selectedSquare = null;
let boardFlipped = false;
let isEngineThinking = false;
let settings = null;
let corpusStatus = { populated: false, puzzleCount: 0, version: null };
let currentHintTier = 0;
let pendingBlunderMove = null;

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
 * Status & theme helpers
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
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);

  let evalCp = 0;
  let isMate = false;
  if (mateMatch) {
    isMate = true;
    evalCp = parseInt(mateMatch[1], 10) > 0 ? 100000 : -100000;
  } else if (cpMatch) {
    evalCp = parseInt(cpMatch[1], 10);
  }

  const evalState = computeEvalBarState({ evalCp, isMateScore: isMate });
  if (engineEvalEl) {
    engineEvalEl.textContent = `Eval: ${evalState.label}`;
  }
  if (evalBarFillEl) {
    evalBarFillEl.style.height = `${evalState.whiteHeightPercent}%`;
  }
  if (pvMatch && pvMovesEl) {
    pvMovesEl.textContent = pvMatch[1];
  }
}

function withTimeout(promise, ms) {
  let handle;
  const timeout = new Promise((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

/* ---------------------------------------------------------------- *
 * Clock display management
 * ---------------------------------------------------------------- */
function startClockTimer() {
  stopClockTimer();
  if (!sessionClock) return;

  opponentClockEl?.classList.remove('hidden');
  userClockEl?.classList.remove('hidden');

  clockIntervalHandle = setInterval(() => {
    if (!sessionClock) return;
    const time = { whiteMs: sessionClock.getTime('white'), blackMs: sessionClock.getTime('black') };
    const isPlayerWhite = (activeSession?.playerColor ?? 'white') === 'white';

    const playerTime = isPlayerWhite ? time.whiteMs : time.blackMs;
    const oppTime = isPlayerWhite ? time.blackMs : time.whiteMs;

    if (userClockEl) {
      userClockEl.textContent = formatClockTime(playerTime);
      userClockEl.classList.toggle('low-time', playerTime <= 30000 && playerTime > 0);
    }
    if (opponentClockEl) {
      opponentClockEl.textContent = formatClockTime(oppTime);
      opponentClockEl.classList.toggle('low-time', oppTime <= 30000 && oppTime > 0);
    }

    const flagFallen = sessionClock.isFlagFallen('white') ? 'white' : (sessionClock.isFlagFallen('black') ? 'black' : null);
    if (flagFallen) {
      stopClockTimer();
      const playerWon = (isPlayerWhite && flagFallen === 'black') || (!isPlayerWhite && flagFallen === 'white');
      setMoveStatus(playerWon ? 'Opponent ran out of time! You win! 🏆' : 'Time ran out! Game over. ⏱️');
      if (activeSession) {
        activeSession.result = playerWon ? (isPlayerWhite ? '1-0' : '0-1') : (isPlayerWhite ? '0-1' : '1-0');
        void showScoreSummary(activeSession);
      }
    }
  }, 100);
}

function stopClockTimer() {
  if (clockIntervalHandle) {
    clearInterval(clockIntervalHandle);
    clockIntervalHandle = null;
  }
}

/* ---------------------------------------------------------------- *
 * Board rendering
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

  const rankOrder = boardFlipped ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
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
        const themeId = settings?.theme ?? 'cat';
        const img = document.createElement('img');
        img.src = `assets/pieces/${themeId}/${piece.color}/${piece.type}.png`;
        img.alt = `${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`;
        img.className = `piece animal-piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        img.draggable = false;
        img.dataset.piece = `${piece.color}${piece.type}`;
        img.addEventListener('error', () => {
          const fallback = document.createElement('span');
          fallback.textContent = piece.color === 'w' ? PIECES[piece.type.toUpperCase()] : PIECES[piece.type];
          fallback.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
          fallback.dataset.piece = `${piece.color}${piece.type}`;
          img.replaceWith(fallback);
        }, { once: true });
        div.appendChild(img);
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
  const isPlayerTurn = chess.turn() === (activeSession?.playerColor === 'black' ? 'b' : 'w');
  turnIndicatorEl.textContent = isPlayerTurn ? 'Your turn to pounce!' : 'Stockfish is thinking…';
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
 * Move Handling & Blunder Confirmation Gate
 * ---------------------------------------------------------------- */
async function handleSquareClick(square) {
  if (!activeSession) {
    setMoveStatus('Start a session first — tap "Pounce on Weakness" or "Free Play".');
    return;
  }
  if (isEngineThinking) return;
  if (chess.isGameOver?.()) return;

  const isPlayerTurn = chess.turn() === (activeSession.playerColor === 'black' ? 'b' : 'w');
  if (!isPlayerTurn) return;

  const piece = chess.get(square);

  if (selectedSquare) {
    if (legalTargetsFrom(selectedSquare).includes(square)) {
      await initiatePlayerMove(selectedSquare, square);
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

async function initiatePlayerMove(from, to) {
  const uci = from + to;
  const fenBefore = chess.fen();

  // Check blunder candidate before committing
  if (engineClient) {
    try {
      const blunderCheck = await checkBlunderCandidate(fenBefore, uci, engineClient);
      if (blunderCheck?.isBlunder) {
        pendingBlunderMove = { from, to, uci };
        const warningEl = el('blunder-warning-text');
        if (warningEl && blunderCheck.message) {
          warningEl.textContent = blunderCheck.message;
        }
        el('blunder-modal')?.classList.remove('hidden');
        selectedSquare = null;
        renderBoard();
        return;
      }
    } catch (err) {
      console.warn('Blunder check non-fatal error:', err);
    }
  }

  await executePlayerMove(from, to);
}

async function executePlayerMove(from, to) {
  let move = null;
  try {
    move = chess.move({ from, to, promotion: 'q' });
  } catch {
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

  if (sessionClock) {
    if (!sessionClock.isRunning) sessionClock.start(chess.turn() === 'b' ? 'black' : 'white');
    else sessionClock.switchTurn();
  }

  const uci = move.from + move.to + (move.promotion ?? '');

  isEngineThinking = true;
  setMoveStatus(`${activeSession.persona ? resolvePersona(activeSession.persona).name : 'Stockfish'} is calculating…`);
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

  if (sessionClock && sessionClock.isRunning) {
    sessionClock.switchTurn();
  }

  if (result.currentFen && chess.fen() !== result.currentFen) {
    chess = new Chess(result.currentFen);
  }

  if (chess.isGameOver?.()) {
    stopClockTimer();
    let res = '1/2-1/2';
    if (chess.isCheckmate?.()) {
      res = chess.turn() === 'w' ? '0-1' : '1-0';
    }
    activeSession.result = res;
    setMoveStatus('Game over! Complete session to view your score.');
    void showScoreSummary(activeSession);
  } else {
    setMoveStatus('Your move.');
  }
  renderBoard();
}

/* ---------------------------------------------------------------- *
 * In-game actions: Hints, Takeback, Draw, Resign
 * ---------------------------------------------------------------- */
async function openHintModal() {
  if (!activeSession) {
    setMoveStatus('Start a session first to request hints.');
    return;
  }
  currentHintTier = 1;
  el('hint-tier-2')?.classList.add('hidden');
  el('hint-tier-3')?.classList.add('hidden');
  const moreBtn = el('btn-hint-more');
  if (moreBtn) {
    moreBtn.disabled = false;
    moreBtn.textContent = '🐾 Need More Help?';
  }

  const t1El = el('hint-text-1');
  if (t1El) t1El.textContent = 'Calculating board awareness…';
  el('hint-modal')?.classList.remove('hidden');

  try {
    const hint1 = await generateHint(chess.fen(), 'warm', engineClient);
    if (t1El) t1El.textContent = hint1.message;
    activeSession.recordHint('warm', hint1.type);
  } catch (err) {
    if (t1El) t1El.textContent = 'Look for undefended pieces and active squares.';
  }
}

async function requestNextHintTier() {
  if (!activeSession) return;
  if (currentHintTier === 1) {
    currentHintTier = 2;
    el('hint-tier-2')?.classList.remove('hidden');
    const t2El = el('hint-text-2');
    if (t2El) t2El.textContent = 'Searching opponent threats…';

    try {
      const hint2 = await generateHint(chess.fen(), 'warmer', engineClient);
      if (t2El) t2El.textContent = hint2.message;
      activeSession.recordHint('warmer', hint2.type);
    } catch {
      if (t2El) t2El.textContent = 'Watch out for opponent tactical counters.';
    }
  } else if (currentHintTier === 2) {
    currentHintTier = 3;
    el('hint-tier-3')?.classList.remove('hidden');
    const t3El = el('hint-text-3');
    if (t3El) t3El.textContent = 'Finding best piece to move…';
    const moreBtn = el('btn-hint-more');
    if (moreBtn) {
      moreBtn.disabled = true;
      moreBtn.textContent = 'Max Hint Reached';
    }

    try {
      const hint3 = await generateHint(chess.fen(), 'hot', engineClient);
      if (t3El) t3El.textContent = hint3.message;
      activeSession.recordHint('hot', hint3.type);
    } catch {
      if (t3El) t3El.textContent = 'Look for the most forcing move.';
    }
  }
}

function handleTakeback() {
  if (!activeSession || activeSession.logs.length === 0) {
    setMoveStatus('No moves to take back.');
    return;
  }
  const tb = activeSession.takeback();
  chess = new Chess(tb.revertedFen);
  selectedSquare = null;
  renderBoard();
  if (moveLogEl) {
    moveLogEl.innerHTML = '<div class="empty-log-message">Move taken back. Try another line! 🐾</div>';
    for (const log of activeSession.logs) {
      appendLog(log.ply_number, log.move_played);
    }
  }
  setMoveStatus(`Takeback applied (${tb.takebackCount} total). Assistance level: ${activeSession.computeAssistanceLevel()}.`);
}

async function handleOfferDraw() {
  if (!activeSession) return;
  setMoveStatus('Offering draw to Stockfish…');
  const offer = await activeSession.offerDraw();
  if (offer.accepted) {
    stopClockTimer();
    setMoveStatus('Draw agreed! (Evaluation is within +/- 0.75 pawns). 🤝');
    void showScoreSummary(activeSession);
  } else {
    setMoveStatus('Draw declined. Stockfish wants to play on! ⚔️');
  }
}

function handleResign() {
  if (!activeSession) return;
  if (!window.confirm('Resign the game?')) return;
  stopClockTimer();
  activeSession.resign();
  setMoveStatus('You resigned. Game over.');
  void showScoreSummary(activeSession);
}

/* ---------------------------------------------------------------- *
 * Score & completion modal
 * ---------------------------------------------------------------- */
async function showScoreSummary(session) {
  const summary = session.summary();
  const score = calculateSeedScore(summary);

  const gradeEl = el('score-grade');
  const totalEl = el('score-total');
  const accEl = el('score-accuracy');
  const motifEl = el('score-motif');
  const hintsEl = el('score-hints');
  const assistEl = el('score-assistance');

  if (gradeEl) gradeEl.textContent = score.grade;
  if (totalEl) totalEl.textContent = score.totalScore;
  if (accEl) accEl.textContent = score.accuracyComponent.toFixed(1);
  if (motifEl) motifEl.textContent = score.motifComponent.toFixed(1);
  if (hintsEl) hintsEl.textContent = `-${score.hintPenalty.toFixed(1)}`;
  if (assistEl) assistEl.textContent = summary.assistance_level.toUpperCase();

  el('score-modal')?.classList.remove('hidden');

  // Save score and update streaks in SQLite
  try {
    await mobileStorage.saveSeedScore(db, {
      gameId: session.gameId,
      accuracyComponent: score.accuracyComponent,
      motifComponent: score.motifComponent,
      hintPenalty: score.hintPenalty,
      totalScore: score.totalScore,
      letterGrade: score.grade,
      assistanceLevel: summary.assistance_level,
    });

    await mobileStorage.recordDailySession(db, session.gameId);
    const today = new Date().toISOString().slice(0, 10);
    const todayStats = await mobileStorage.getDailyStats(db, today);
    const streakState = await mobileStorage.getStreakState(db);

    const updatedStreak = processDailyStreakUpdate({
      streakState,
      currentDate: today,
      sessionsCompletedToday: todayStats?.sessionsCompleted ?? 1,
      goalTarget: Number(settings?.daily_goal) || 3,
    });
    await mobileStorage.updateStreakState(db, updatedStreak);

    if (session.seededWeakness) {
      const currentMastery = await mobileStorage.getCategoryMastery(db);
      const curLvl = currentMastery[session.seededWeakness]?.masteryLevel ?? 0;
      const nextLvl = advanceCategoryMastery(curLvl, score.totalScore);
      await mobileStorage.updateCategoryMastery(db, {
        category: session.seededWeakness,
        masteryLevel: nextLvl,
        lastPracticedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('Could not record score/streak in SQLite:', err);
  }
}

/* ---------------------------------------------------------------- *
 * Session lifecycle
 * ---------------------------------------------------------------- */
function syncSessionToBoard(session) {
  activeSession = session;
  const fen = session?.currentFen ?? session?.startFen;
  chess = fen ? new Chess(fen) : new Chess();
  boardFlipped = (session?.playerColor ?? 'white') === 'black';
  selectedSquare = null;

  if (session?.timeControl && session.timeControl !== 'none') {
    sessionClock = new ChessClock({ timeControl: session.timeControl });
    startClockTimer();
  } else {
    sessionClock = null;
    stopClockTimer();
    opponentClockEl?.classList.add('hidden');
    userClockEl?.classList.add('hidden');
  }

  const personaObj = resolvePersona(session?.persona);
  if (opponentAvatarEl) opponentAvatarEl.textContent = personaObj.avatar;
  if (opponentNameEl) opponentNameEl.textContent = `${personaObj.name} (~${personaObj.targetElo} Elo)`;

  if (moveLogEl) {
    moveLogEl.innerHTML = '<div class="empty-log-message">Position loaded. Your move! 🐾</div>';
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
    setMoveStatus('Targeted hunt started. Pounce!');
  } catch (err) {
    setFatal('Could not start a session.', err);
  }
}

async function startFreeplaySession() {
  try {
    const persona = settings?.freeplay_persona || 'tabby';
    const timeControl = settings?.freeplay_time_control || '3|2';
    const playerColor = 'white';

    const session = new PracticeSession({
      mode: 'freeplay',
      persona,
      timeControl,
      playerColor,
      engine: engineClient,
      gameId: `freeplay-${Date.now()}`,
    });

    if (targetNameEl) targetNameEl.textContent = 'Free Play vs Stockfish';
    if (targetDescEl) targetDescEl.textContent = `Persona: ${resolvePersona(persona).name} • Clock: ${timeControl}`;
    if (queueIndicatorEl) queueIndicatorEl.textContent = 'Unseeded';
    if (sessionBadgeEl) sessionBadgeEl.textContent = 'Free Play ⚔️';

    syncSessionToBoard(session);
    setMoveStatus('Free play game started! Make your move.');
  } catch (err) {
    setFatal('Could not start free play session.', err);
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
  stopClockTimer();
  try {
    await orchestrator.completeSession(activeSession);
    await showScoreSummary(activeSession);
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
 * Profile & settings
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
  const today = new Date().toISOString().slice(0, 10);
  stats.todayStats = await mobileStorage.getDailyStats(db, today);
  stats.streakState = await mobileStorage.getStreakState(db);
  stats.categoryMastery = await mobileStorage.getCategoryMastery(db);

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
    for (const key of ['display_name', 'cat_avatar', 'chesscom_username', 'engine_skill_level', 'theme', 'daily_goal', 'freeplay_persona', 'freeplay_time_control']) {
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

  el('btn-db-export')?.addEventListener('click', async () => {
    try {
      const data = await mobileStorage.exportDatabaseJson(db);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cat_analyst_backup_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Database exported');
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  });

  el('btn-db-import')?.addEventListener('click', () => {
    el('db-import-file')?.click();
  });

  el('db-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await mobileStorage.importDatabaseJson(db, payload);
      alert('Database restored successfully!');
      await refreshProfile();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
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
  setMoveStatus('Tap "Pounce on Weakness" or "Free Play" to begin.');
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

  // Action listeners
  el('btn-start-target')?.addEventListener('click', startTargetedSession);
  el('btn-freeplay')?.addEventListener('click', startFreeplaySession);
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

  el('btn-hint')?.addEventListener('click', openHintModal);
  el('btn-hint-more')?.addEventListener('click', requestNextHintTier);
  el('btn-hint-close')?.addEventListener('click', () => el('hint-modal')?.classList.add('hidden'));

  el('btn-takeback')?.addEventListener('click', handleTakeback);
  el('btn-draw')?.addEventListener('click', handleOfferDraw);
  el('btn-resign')?.addEventListener('click', handleResign);

  el('btn-blunder-cancel')?.addEventListener('click', () => {
    pendingBlunderMove = null;
    el('blunder-modal')?.classList.add('hidden');
    setMoveStatus('Move cancelled. Choose a better line!');
  });

  el('btn-blunder-confirm')?.addEventListener('click', async () => {
    el('blunder-modal')?.classList.add('hidden');
    if (pendingBlunderMove) {
      const { from, to } = pendingBlunderMove;
      pendingBlunderMove = null;
      await executePlayerMove(from, to);
    }
  });

  el('btn-score-continue')?.addEventListener('click', () => {
    el('score-modal')?.classList.add('hidden');
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
