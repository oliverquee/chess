// Standard chess piece characters (Standard silhouettes with warm styling)
const PIECES = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

// Seed Puzzles Corpus for Start-Slow Practice Across Taxonomy
const SEED_PUZZLES = [
  {
    PuzzleId: 'tactical-short',
    FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    Moves: 'e2e4 e7e5 g1f3 b8c6',
    Themes: 'fork tactical',
    Rating: 1200,
    weaknessCategory: 'tactical',
  },
  {
    PuzzleId: 'tactical-long',
    FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    Moves: 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6',
    Themes: 'fork tactical',
    Rating: 1450,
    weaknessCategory: 'tactical',
  },
  {
    PuzzleId: 'kingsafety-short',
    FEN: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    Moves: 'f8c5 d2d3 g8f6',
    Themes: 'kingsideAttack king_safety',
    Rating: 1250,
    weaknessCategory: 'king_safety',
  },
  {
    PuzzleId: 'kingsafety-long',
    FEN: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    Moves: 'f8c5 d2d3 g8f6 b1c3 d7d6 c1g5 h7h6 g5h4',
    Themes: 'kingsideAttack king_safety',
    Rating: 1400,
    weaknessCategory: 'king_safety',
  },
];

/**
 * Lightweight, robust FEN state manager that runs reliably offline & in WebViews
 */
class BoardState {
  constructor(fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1') {
    this.setFen(fen);
  }

  setFen(fen) {
    this.fen = fen;
    const [placement, turn, castling, ep, half, full] = fen.split(' ');
    this.activeColor = turn || 'w';
    this.castling = castling || '-';
    this.enPassant = ep || '-';
    this.halfMoves = parseInt(half, 10) || 0;
    this.fullMoves = parseInt(full, 10) || 1;

    this.grid = Array(8).fill(null).map(() => Array(8).fill(null));
    const ranks = placement.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const char of ranks[r]) {
        if (/\d/.test(char)) {
          f += parseInt(char, 10);
        } else {
          this.grid[r][f] = {
            type: char.toLowerCase(),
            color: char === char.toUpperCase() ? 'w' : 'b',
          };
          f++;
        }
      }
    }
  }

  get(square) {
    const file = square.charCodeAt(0) - 97;
    const rank = 8 - parseInt(square[1], 10);
    if (rank >= 0 && rank < 8 && file >= 0 && file < 8) {
      return this.grid[rank][file];
    }
    return null;
  }

  turn() {
    return this.activeColor;
  }

  getBoard() {
    return this.grid;
  }

  move({ from, to, promotion }) {
    const fromPiece = this.get(from);
    if (!fromPiece) return null;

    const fromFile = from.charCodeAt(0) - 97;
    const fromRank = 8 - parseInt(from[1], 10);
    const toFile = to.charCodeAt(0) - 97;
    const toRank = 8 - parseInt(to[1], 10);

    const pieceType = promotion ? promotion.toLowerCase() : fromPiece.type;
    this.grid[toRank][toFile] = {
      type: pieceType,
      color: fromPiece.color,
    };
    this.grid[fromRank][fromFile] = null;

    this.activeColor = this.activeColor === 'w' ? 'b' : 'w';
    return {
      from,
      to,
      color: fromPiece.color,
      san: `${fromPiece.type !== 'p' ? fromPiece.type.toUpperCase() : ''}${to}`,
    };
  }

  getLegalMovesFor(square) {
    const piece = this.get(square);
    if (!piece || piece.color !== this.activeColor) return [];

    const file = square.charCodeAt(0) - 97;
    const rank = 8 - parseInt(square[1], 10);
    const targets = [];

    // Standard simple candidate moves for interactive practice
    if (piece.type === 'p') {
      const dir = piece.color === 'w' ? -1 : 1;
      const startRank = piece.color === 'w' ? 6 : 1;
      if (rank + dir >= 0 && rank + dir < 8 && !this.grid[rank + dir][file]) {
        targets.push(`${String.fromCharCode(97 + file)}${8 - (rank + dir)}`);
        if (rank === startRank && !this.grid[rank + 2 * dir][file]) {
          targets.push(`${String.fromCharCode(97 + file)}${8 - (rank + 2 * dir)}`);
        }
      }
      for (const df of [-1, 1]) {
        const nf = file + df;
        const nr = rank + dir;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && this.grid[nr][nf] && this.grid[nr][nf].color !== piece.color) {
          targets.push(`${String.fromCharCode(97 + nf)}${8 - nr}`);
        }
      }
    } else if (piece.type === 'n') {
      const deltas = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
      for (const [dr, df] of deltas) {
        const nr = rank + dr;
        const nf = file + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          if (!this.grid[nr][nf] || this.grid[nr][nf].color !== piece.color) {
            targets.push(`${String.fromCharCode(97 + nf)}${8 - nr}`);
          }
        }
      }
    } else {
      // General sliding / king moves
      const directions = piece.type === 'b' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
                         piece.type === 'r' ? [[-1, 0], [1, 0], [0, -1], [0, 1]] :
                         piece.type === 'q' || piece.type === 'k' ? [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]] : [];
      const maxDist = piece.type === 'k' ? 1 : 7;
      for (const [dr, df] of directions) {
        for (let dist = 1; dist <= maxDist; dist++) {
          const nr = rank + dr * dist;
          const nf = file + df * dist;
          if (nr < 0 || nr >= 8 || nf < 0 || nf >= 8) break;
          if (!this.grid[nr][nf]) {
            targets.push(`${String.fromCharCode(97 + nf)}${8 - nr}`);
          } else {
            if (this.grid[nr][nf].color !== piece.color) {
              targets.push(`${String.fromCharCode(97 + nf)}${8 - nr}`);
            }
            break;
          }
        }
      }
    }

    return targets;
  }
}

/**
 * In-memory / browser SQLite storage adapter
 */
class BrowserStorageAdapter {
  constructor() {
    this.games = new Map();
    this.moves = new Map();
    this.weaknessTags = [];
  }

  async createQueuedGames(db, games) {
    for (const g of games) {
      this.games.set(g.id, {
        ...g,
        status: 'queued',
        result: null,
      });
      this.moves.set(g.id, []);
    }
    return games.map((g) => g.id);
  }

  async getGameStatus(db, gameId) {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game not found: ${gameId}`);
    return game.status;
  }

  async transitionGameStatus(db, gameId, nextStatus) {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game not found: ${gameId}`);
    game.status = nextStatus;
    return nextStatus;
  }

  async completeGameSession(db, summary) {
    const game = this.games.get(summary.id);
    if (!game) throw new Error(`Game not found: ${summary.id}`);
    game.status = 'completed';
    game.result = summary.result ?? '*';
    game.current_fen = summary.current_fen;
    this.moves.set(summary.id, [...(summary.moves || [])]);
    return summary.id;
  }

  async getGameHistory(db, { weaknessCategory } = {}) {
    const list = Array.from(this.games.values()).map((g) => ({
      ...g,
      moves: this.moves.get(g.id) || [],
    }));
    if (weaknessCategory) {
      return list.filter((g) => g.seeded_weakness === weaknessCategory);
    }
    return list;
  }

  async saveWeaknessTags(db, moveId, tags) {
    const normalized = Array.isArray(tags) ? tags : [tags];
    for (const tag of normalized) {
      this.weaknessTags.push({ moveId, ...tag });
    }
    return normalized.map((_, i) => i + 1);
  }

  async getWeaknessTally(db) {
    const counts = {};
    for (const tag of this.weaknessTags) {
      counts[tag.category] = (counts[tag.category] || 0) + 1;
    }
    return Object.entries(counts).map(([category, count]) => ({ category, count }));
  }
}

// Global Application State
const storageAdapter = new BrowserStorageAdapter();
let boardState = new BoardState();
let activeSession = null;
let queuedSessions = [];
let orientation = 'black';
let selectedSquare = null;
let stockfishWorker = null;
let isEngineThinking = false;
let moveLogs = [];

// DOM Elements
const boardEl = document.getElementById('chessboard');
const targetNameEl = document.getElementById('target-name');
const targetDescEl = document.getElementById('target-desc');
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
 * Stockfish Web Worker Integration
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
    updateStatus('Stockfish 18 Lite WASM Active 🐾');
  } catch (err) {
    updateStatus('Practice Mode (Engine Emulation Active) 🐾');
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
  if (systemStatusEl) systemStatusEl.textContent = `${text} • Cat Analyst`;
}

/**
 * Render the 8x8 Chess Board with Orange Cat styling
 */
function renderBoard() {
  if (!boardEl) return;
  boardEl.innerHTML = '';
  const grid = boardState.getBoard();
  const ranks = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const legalMoves = selectedSquare ? boardState.getLegalMovesFor(selectedSquare) : [];

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
        const pieceOnSquare = boardState.get(squareName);
        if (pieceOnSquare) squareDiv.classList.add('has-piece');
      }

      const piece = grid[r][f];
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

  const piece = boardState.get(square);
  const isPlayerTurn = (boardState.turn() === 'w' && orientation === 'white') ||
                       (boardState.turn() === 'b' && orientation === 'black');

  if (!isPlayerTurn) return;

  if (selectedSquare) {
    if (selectedSquare === square) {
      selectedSquare = null;
      renderBoard();
      return;
    }

    const legal = boardState.getLegalMovesFor(selectedSquare);
    if (legal.includes(square)) {
      const move = boardState.move({ from: selectedSquare, to: square, promotion: 'q' });
      selectedSquare = null;
      if (move) {
        recordPlayerMove(move);
        renderBoard();
        triggerEngineResponse();
        return;
      }
    }
  }

  if (piece && piece.color === boardState.turn()) {
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
    uci: `${move.from}${move.to}`,
    color: move.color,
  };
  moveLogs.push(entry);
  appendLogUI(entry);
}

function triggerEngineResponse() {
  isEngineThinking = true;
  if (moveStatusEl) moveStatusEl.textContent = 'Orange Cat Stockfish is calculating… 🐈‍⬛';

  if (stockfishWorker) {
    stockfishWorker.postMessage(`position fen ${boardState.fen}`);
    stockfishWorker.postMessage('go depth 12');
  } else {
    setTimeout(() => {
      // Deterministic practice response
      const turn = boardState.turn();
      const allMoves = [];
      const grid = boardState.getBoard();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = grid[r][f];
          if (p && p.color === turn) {
            const sq = `${String.fromCharCode(97 + f)}${8 - r}`;
            const targets = boardState.getLegalMovesFor(sq);
            for (const t of targets) allMoves.push({ from: sq, to: t });
          }
        }
      }
      if (allMoves.length > 0) {
        const chosen = allMoves[0];
        applyEngineMove(`${chosen.from}${chosen.to}`);
      }
      isEngineThinking = false;
    }, 500);
  }
}

function applyEngineMove(uciMove) {
  if (!uciMove || uciMove.length < 4) return;
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);

  const move = boardState.move({ from, to });
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
  if (!moveLogEl) return;
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
  if (!moveStatusEl) return;
  const turn = boardState.turn();
  const isPlayerTurn = (turn === 'w' && orientation === 'white') ||
                       (turn === 'b' && orientation === 'black');

  moveStatusEl.textContent = isPlayerTurn
    ? `Your turn to pounce! (${orientation === 'white' ? 'White' : 'Black'}) 🐾`
    : 'Stockfish turn 🐈‍⬛';
}

/**
 * Start Targeted Training Cycle (Start-Slow 2 Seeds)
 */
async function startTargetedWeaknessSession(category = 'tactical') {
  const shortPuzzle = SEED_PUZZLES.find((p) => p.weaknessCategory === category && p.PuzzleId.includes('short')) || SEED_PUZZLES[0];
  const longPuzzle = SEED_PUZZLES.find((p) => p.weaknessCategory === category && p.PuzzleId.includes('long')) || SEED_PUZZLES[1];

  const now = new Date().toISOString();
  const session1Id = `session-${Date.now()}-1`;
  const session2Id = `session-${Date.now()}-2`;

  // Start with motif-ready position: e2e4 played
  const startFen1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const startFen2 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

  queuedSessions = [
    {
      id: session1Id,
      puzzle: shortPuzzle,
      start_fen: startFen1,
      seeded_weakness: category,
      seed_puzzle_id: shortPuzzle.PuzzleId,
      date: now,
    },
    {
      id: session2Id,
      puzzle: longPuzzle,
      start_fen: startFen2,
      seeded_weakness: category,
      seed_puzzle_id: longPuzzle.PuzzleId,
      date: now,
    },
  ];

  await storageAdapter.createQueuedGames(null, queuedSessions);
  await storageAdapter.transitionGameStatus(null, session1Id, 'in_progress');

  activeSession = queuedSessions[0];
  boardState = new BoardState(startFen1);
  moveLogs = [];
  if (moveLogEl) {
    moveLogEl.innerHTML = `<div class="empty-log-message">Motif-ready FEN active. White played 1. e4. Your move as Black! 🐾</div>`;
  }
  selectedSquare = null;
  orientation = 'black';

  if (targetNameEl) targetNameEl.textContent = `${category.replace('_', ' ').toUpperCase()} Motifs`;
  if (targetDescEl) targetDescEl.textContent = 'Start-slow: 2 seed puzzles queued';
  if (targetQueueEl) targetQueueEl.textContent = 'Seed 1 of 2 🐟';

  renderBoard();
  updateStatus(`Hunting Weakness: ${category}`);
}

async function startNextQueuedSession() {
  if (queuedSessions.length >= 2 && activeSession?.id !== queuedSessions[1].id) {
    const second = queuedSessions[1];
    await storageAdapter.transitionGameStatus(null, second.id, 'in_progress');
    activeSession = second;

    boardState = new BoardState(second.start_fen);
    moveLogs = [];
    if (moveLogEl) {
      moveLogEl.innerHTML = `<div class="empty-log-message">Seed 2 of 2 active. White played setup. Your turn to pounce! 🐾</div>`;
    }
    selectedSquare = null;
    orientation = 'black';

    if (targetQueueEl) targetQueueEl.textContent = 'Seed 2 of 2 🐟';
    renderBoard();
    updateStatus('Seed 2 of 2 Active');
  } else {
    alert('All queued seeds for this hunt completed! Start a new target pounce. 🐾');
  }
}

async function completeActiveSession() {
  if (!activeSession) return;

  const summary = {
    id: activeSession.id,
    mode: 'practice',
    result: '*',
    seeded_weakness: activeSession.seeded_weakness,
    seed_puzzle_id: activeSession.seed_puzzle_id,
    start_fen: activeSession.start_fen,
    current_fen: boardState.fen,
    moves: [...moveLogs],
  };

  await storageAdapter.completeGameSession(null, summary);
  updateStatus('Purr-fect! Session saved for AI analysis 🐾');
  alert(`Purr-fect! Practice session ${activeSession.id} saved & logged to storage.`);
}

// Event Listeners
if (btnStartTarget) btnStartTarget.addEventListener('click', () => startTargetedWeaknessSession('tactical'));
if (btnNextQueued) btnNextQueued.addEventListener('click', () => startNextQueuedSession());
if (btnFlip) btnFlip.addEventListener('click', () => {
  orientation = orientation === 'white' ? 'black' : 'white';
  renderBoard();
});
if (btnComplete) btnComplete.addEventListener('click', () => completeActiveSession());

if (tabMovesBtn && tabPreviewBtn) {
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
}

// Initial Boot
initStockfish();
startTargetedWeaknessSession('tactical');
