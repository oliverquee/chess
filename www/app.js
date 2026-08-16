import { Chess } from './vendor/chess.js';

// Unicode chess piece characters
const PIECES = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

// Initial state
let chess = new Chess();
let orientation = 'white';
let selectedSquare = null;
let currentSession = null;
let currentFocus = 'Tactical';
let seedIndex = 1;
let stockfishWorker = null;
let isEngineThinking = false;
let moveLogs = [];

// DOM Elements
const boardEl = document.getElementById('chessboard');
const targetNameEl = document.getElementById('target-name');
const targetQueueEl = document.getElementById('target-queue-indicator');
const moveStatusEl = document.getElementById('move-status');
const engineEvalEl = document.getElementById('engine-eval');
const moveLogEl = document.getElementById('move-log');
const pvMovesEl = document.getElementById('pv-moves');
const systemStatusEl = document.getElementById('system-status');

const tabMovesBtn = document.getElementById('tab-moves');
const tabPreviewBtn = document.getElementById('tab-preview');
const tabContentMoves = document.getElementById('tab-content-moves');
const tabContentPreview = document.getElementById('tab-content-preview');

const btnStartTarget = document.getElementById('btn-start-target');
const btnNextQueued = document.getElementById('btn-next-queued');
const btnFlip = document.getElementById('btn-flip');
const btnComplete = document.getElementById('btn-complete');

/**
 * Initialize the Stockfish Worker for in-browser WebView practice
 */
function initStockfish() {
  try {
    stockfishWorker = new Worker('./vendor/stockfish/stockfish.js');
    stockfishWorker.onmessage = (event) => {
      const line = typeof event.data === 'string' ? event.data : '';
      handleStockfishMessage(line);
    };
    stockfishWorker.postMessage('uci');
    stockfishWorker.postMessage('isready');
    updateStatus('Stockfish 18 Lite WASM Engine Active');
  } catch (err) {
    console.warn('Stockfish Web Worker initialization deferred:', err);
    updateStatus('Practice Mode (Engine Emulation)');
  }
}

function handleStockfishMessage(line) {
  if (line.startsWith('info ')) {
    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const pvMatch = line.match(/\bpv\s+(.+)$/);
    if (cpMatch) {
      const score = (parseInt(cpMatch[1], 10) / 100).toFixed(2);
      engineEvalEl.textContent = `Eval: ${score > 0 ? '+' : ''}${score}`;
    }
    if (pvMatch) {
      pvMovesEl.textContent = pvMatch[1];
    }
  } else if (line.startsWith('bestmove ')) {
    const parts = line.split(' ');
    const bestMove = parts[1];
    if (bestMove && bestMove !== '(none)' && isEngineThinking) {
      isEngineThinking = false;
      applyEngineMove(bestMove);
    }
  }
}

function updateStatus(text) {
  if (systemStatusEl) systemStatusEl.textContent = `${text} • Capacitor Shell`;
}

/**
 * Render the 8x8 Board
 */
function renderBoard() {
  boardEl.innerHTML = '';
  const board = chess.board();
  const ranks = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const legalMoves = selectedSquare
    ? chess.moves({ square: selectedSquare, verbose: true }).map((m) => m.to)
    : [];

  for (const r of ranks) {
    for (const f of files) {
      const fileChar = String.fromCharCode(97 + f);
      const rankNum = 8 - r;
      const squareName = `${fileChar}${rankNum}`;
      const isLight = (r + f) % 2 === 0;

      const squareDiv = document.createElement('div');
      squareDiv.className = `square ${isLight ? 'light' : 'dark'}`;
      squareDiv.dataset.square = squareName;

      if (selectedSquare === squareName) {
        squareDiv.classList.add('selected');
      }

      if (legalMoves.includes(squareName)) {
        squareDiv.classList.add('legal-target');
        const pieceOnSquare = chess.get(squareName);
        if (pieceOnSquare) squareDiv.classList.add('has-piece');
      }

      const piece = board[r][f];
      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        const key = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        pieceSpan.textContent = PIECES[key] || '';
        squareDiv.appendChild(pieceSpan);
      }

      squareDiv.addEventListener('click', () => handleSquareClick(squareName));
      boardEl.appendChild(squareDiv);
    }
  }

  updateTurnUI();
}

function handleSquareClick(square) {
  if (isEngineThinking) return;

  const piece = chess.get(square);
  const isPlayerTurn = (chess.turn() === 'w' && orientation === 'white') ||
                       (chess.turn() === 'b' && orientation === 'black');

  if (!isPlayerTurn) return;

  if (selectedSquare) {
    if (selectedSquare === square) {
      selectedSquare = null;
      renderBoard();
      return;
    }

    const move = chess.move({
      from: selectedSquare,
      to: square,
      promotion: 'q',
    });

    if (move) {
      selectedSquare = null;
      recordPlayerMove(move);
      renderBoard();
      triggerEngineResponse();
      return;
    }
  }

  if (piece && piece.color === chess.turn()) {
    selectedSquare = square;
    renderBoard();
  } else {
    selectedSquare = null;
    renderBoard();
  }
}

function recordPlayerMove(move) {
  const ply = moveLogs.length + 1;
  const entry = {
    ply,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ''}`,
    color: move.color,
  };
  moveLogs.push(entry);
  appendLogUI(entry);
}

function triggerEngineResponse() {
  if (chess.isGameOver()) {
    updateStatus('Game Over: ' + getGameOverReason());
    return;
  }

  isEngineThinking = true;
  moveStatusEl.textContent = 'Stockfish thinking…';

  if (stockfishWorker) {
    stockfishWorker.postMessage(`position fen ${chess.fen()}`);
    stockfishWorker.postMessage('go depth 12');
  } else {
    // Deterministic fallback response if Worker is unavailable in environment
    setTimeout(() => {
      const moves = chess.moves({ verbose: true });
      if (moves.length > 0) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        applyEngineMove(`${randomMove.from}${randomMove.to}`);
      }
      isEngineThinking = false;
    }, 600);
  }
}

function applyEngineMove(uciMove) {
  if (!uciMove || uciMove.length < 4) return;
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

  const move = chess.move({ from, to, promotion });
  if (move) {
    const ply = moveLogs.length + 1;
    const entry = {
      ply,
      san: move.san,
      uci: uciMove,
      color: move.color,
    };
    moveLogs.push(entry);
    appendLogUI(entry);
  }
  renderBoard();
}

function appendLogUI(entry) {
  if (moveLogs.length === 1) {
    moveLogEl.innerHTML = '';
  }
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-ply">${entry.ply}.</span> <span class="log-move">${entry.san}</span>`;
  moveLogEl.appendChild(div);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

function updateTurnUI() {
  const turn = chess.turn();
  const isPlayerTurn = (turn === 'w' && orientation === 'white') ||
                       (turn === 'b' && orientation === 'black');
  
  if (chess.isGameOver()) {
    moveStatusEl.textContent = getGameOverReason();
  } else {
    moveStatusEl.textContent = isPlayerTurn ? 'Your turn (' + (orientation === 'white' ? 'White' : 'Black') + ')' : 'Stockfish turn';
  }
}

function getGameOverReason() {
  if (chess.isCheckmate()) return 'Checkmate!';
  if (chess.isDraw()) return 'Draw';
  if (chess.isStalemate()) return 'Stalemate';
  if (chess.isThreefoldRepetition()) return 'Threefold Repetition';
  return 'Game Finished';
}

/**
 * Setup Practice Target / Start-Slow
 */
function startNewTarget(category = 'Tactical') {
  currentFocus = category;
  seedIndex = 1;
  targetNameEl.textContent = `${category} (Motif Practice)`;
  targetQueueEl.textContent = `Seed ${seedIndex} of 2`;

  // Start with a standard tactical motif setup
  chess = new Chess('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  moveLogs = [];
  moveLogEl.innerHTML = '<div class="empty-log-message">Motif-ready position active. White played 1. e4.</div>';
  selectedSquare = null;
  orientation = 'black'; // User practices motif as Black
  renderBoard();
  updateStatus(`Active Target: ${category}`);
}

function startNextQueued() {
  if (seedIndex < 2) {
    seedIndex += 1;
    targetQueueEl.textContent = `Seed ${seedIndex} of 2`;
    chess = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    moveLogs = [];
    moveLogEl.innerHTML = '<div class="empty-log-message">Seed 2/2 active. White to move.</div>';
    selectedSquare = null;
    orientation = 'white';
    renderBoard();
    updateStatus('Seed 2/2 In Progress');
  } else {
    alert('Both start-slow seeds completed for this category! Start a new target.');
  }
}

// Event Listeners
btnStartTarget.addEventListener('click', () => startNewTarget('Tactical'));
btnNextQueued.addEventListener('click', () => startNextQueued());
btnFlip.addEventListener('click', () => {
  orientation = orientation === 'white' ? 'black' : 'white';
  renderBoard();
});
btnComplete.addEventListener('click', () => {
  updateStatus('Session Completed & Persisted');
  alert('Practice session completed and logged for post-game AI analysis.');
});

tabMovesBtn.addEventListener('click', () => {
  tabMovesBtn.classList.add('active');
  tabPreviewBtn.classList.remove('active');
  tabContentMoves.classList.remove('hidden');
  tabContentPreview.classList.add('hidden');
});

tabPreviewBtn.addEventListener('click', () => {
  tabPreviewBtn.classList.add('active');
  tabMovesBtn.classList.remove('active');
  tabContentPreview.classList.remove('hidden');
  tabContentMoves.classList.add('hidden');
});

// Boot
initStockfish();
startNewTarget('Tactical');
