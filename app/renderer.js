import { applyThemeToDocument, resolveTheme, THEME_PACKS } from './themes/registry.js';

const api = window.chessAnalyst;
let activeTheme = applyThemeToDocument(document, resolveTheme('cat'));
const files = 'abcdefgh';
let activeGameId = null;
let currentFen = '8/8/8/8/8/8/8/8 w - - 0 1';
let selected = null;

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3500);
}

async function action(fn) {
  try { return await fn(); } catch (error) { toast(error.message); return null; }
}

function fenBoard(fen) {
  return fen.split(' ')[0].split('/').flatMap((rank) => {
    const cells = [];
    for (const token of rank) Number.isInteger(Number(token)) ? cells.push(...Array(Number(token)).fill('')) : cells.push(token);
    return cells;
  });
}

function renderBoard() {
  const board = document.querySelector('#board');
  board.replaceChildren();
  fenBoard(currentFen).forEach((piece, index) => {
    const rank = 8 - Math.floor(index / 8);
    const file = files[index % 8];
    const square = `${file}${rank}`;
    const button = document.createElement('button');
    button.className = `square ${(index + Math.floor(index / 8)) % 2 ? 'dark' : 'light'}${selected === square ? ' selected' : ''}`;
    button.dataset.square = square;
    button.setAttribute('aria-label', `${square}${piece ? ` ${piece}` : ''}`);
    button.textContent = activeTheme.pieces[piece] ?? '';
    button.addEventListener('click', () => selectSquare(square, piece));
    board.append(button);
  });
}

async function selectSquare(square, piece) {
  if (!activeGameId) return;
  if (!selected) { if (piece) selected = square; renderBoard(); return; }
  const from = selected;
  selected = null;
  const promotion = (square.endsWith('1') || square.endsWith('8')) ? 'q' : '';
  const result = await action(() => api.playPracticeMove({ gameId: activeGameId, move: `${from}${square}${promotion}` }));
  if (result) {
    currentFen = result.fen;
    document.querySelector('#future-line').textContent = result.futureLine.join(' ') || 'No engine line available.';
    document.querySelector('#status').textContent = result.engineMove ? `Stockfish replied ${result.engineMove}` : 'Position complete';
  }
  renderBoard();
}

async function refresh() {
  const state = await action(() => api.getState());
  if (!state) return;
  const history = document.querySelector('#history');
  history.replaceChildren();
  const select = document.querySelector('#game-select');
  select.replaceChildren();
  for (const game of state.games) {
    const row = document.createElement('div');
    row.className = 'history-row';
    for (const value of [game.date ?? 'Undated', game.mode, game.status, game.seeded_weakness ?? game.player_color ?? '—']) {
      const cell = document.createElement('span'); cell.textContent = value; row.append(cell);
    }
    history.append(row);
    if (game.status === 'completed') {
      const option = document.createElement('option'); option.value = game.id; option.textContent = `${game.date} · ${game.mode} · ${game.id}`; select.append(option);
    }
  }
}

document.querySelector('#start-practice').addEventListener('click', async () => {
  const category = document.querySelector('#category').value;
  const result = await action(() => api.startPractice({ rankedWeaknesses: [category, 'tactical'] }));
  if (!result?.gameId) { toast(result?.skipped?.[0]?.advice ?? 'No matching puzzles are installed.'); return; }
  activeGameId = result.gameId; currentFen = result.fen; selected = null;
  document.querySelector('#status').textContent = `Training ${result.weaknessCategory}`;
  document.querySelector('#complete-practice').disabled = false;
  renderBoard();
});

document.querySelector('#complete-practice').addEventListener('click', async () => {
  const result = await action(() => api.completePractice({ gameId: activeGameId, result: '*' }));
  if (!result) return; activeGameId = null; document.querySelector('#complete-practice').disabled = true; document.querySelector('#start-next-practice').disabled = false; document.querySelector('#status').textContent = 'Completed'; await refresh();
});

document.querySelector('#start-next-practice').addEventListener('click', async () => {
  const result = await action(() => api.startNextPractice());
  if (!result) { toast('No queued seed remains.'); return; }
  activeGameId = result.gameId; currentFen = result.fen; selected = null;
  document.querySelector('#complete-practice').disabled = false;
  document.querySelector('#start-next-practice').disabled = true;
  document.querySelector('#status').textContent = 'Next seed in progress';
  renderBoard();
});

document.querySelector('#import-pgn').addEventListener('click', async () => {
  const result = await action(() => api.importPgn({ username: document.querySelector('#import-username').value, pgn: document.querySelector('#pgn').value }));
  if (result) { toast(`Imported ${result.gameId}`); await refresh(); }
});

document.querySelector('#analyze').addEventListener('click', async () => {
  const result = await action(() => api.analyzeGame({ gameId: document.querySelector('#game-select').value, backend: document.querySelector('#backend').value, model: document.querySelector('#model').value }));
  if (result) { toast(`${result.classified} classified, ${result.unclassified} unclassified`); await refresh(); }
});

document.querySelector('#save-key').addEventListener('click', async () => {
  const field = document.querySelector('#claude-key');
  const result = await action(() => api.setClaudeKey({ apiKey: field.value }));
  field.value = ''; if (result) toast('Claude key stored with OS protection.');
});

document.querySelector('#open-chesscom').addEventListener('click', () => action(() => api.openChessComTheme()));
const themeSelect = document.querySelector('#theme');
for (const theme of THEME_PACKS) {
  const option = document.createElement('option'); option.value = theme.id; option.textContent = theme.name; themeSelect.append(option);
}
themeSelect.addEventListener('change', async () => {
  activeTheme = applyThemeToDocument(document, resolveTheme(themeSelect.value));
  renderBoard();
  await action(() => api.setTheme({ themeId: activeTheme.id }));
});
renderBoard();
refresh();
