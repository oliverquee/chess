/**
 * DEV-ONLY browser preview. This entry is bundled into artifacts/browser-preview
 * and is never referenced by www/index.html or copied by `npm run cap:sync`.
 * Browser-local persistence here is only a layout test and is not native SQLite
 * evidence.
 */
import { Chess } from 'chess.js';
import { renderProfile } from '../www/profile.js';

const PIECES = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚', P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔' };
const el = (id) => document.getElementById(id);
const chess = new Chess();
let selected = null;

function renderBoard() {
  const board = el('chessboard');
  board.innerHTML = '';
  const targets = selected ? chess.moves({ square: selected, verbose: true }).map((move) => move.to) : [];
  chess.board().forEach((rank, rankIndex) => rank.forEach((piece, fileIndex) => {
    const square = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `square ${(rankIndex + fileIndex) % 2 === 0 ? 'light' : 'dark'}`;
    cell.dataset.square = square;
    if (selected === square) cell.classList.add('selected');
    if (targets.includes(square)) cell.classList.add('legal-target');
    if (piece) {
      const glyph = document.createElement('span');
      glyph.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
      glyph.textContent = PIECES[piece.color === 'w' ? piece.type.toUpperCase() : piece.type];
      cell.appendChild(glyph);
    }
    cell.addEventListener('click', () => {
      if (selected && targets.includes(square)) chess.move({ from: selected, to: square, promotion: 'q' });
      selected = piece?.color === chess.turn() ? square : null;
      renderBoard();
    });
    board.appendChild(cell);
  }));
}

function settings() {
  const saved = JSON.parse(localStorage.getItem('m9-browser-preview-settings') || '{}');
  return { display_name: '', cat_avatar: 'orange-tabby', chesscom_username: 'lastautumnleaf1', engine_skill_level: '10', theme: 'cat', ...saved };
}

function renderDevProfile() {
  renderProfile({
    container: el('profile-page'),
    stats: { totalSessions: 0, totalMoves: 0, weaknessTally: [], recentSessions: [] },
    settings: settings(),
    corpusStatus: { populated: true, version: 'm9-v1', puzzleCount: 7200 },
    focus: { weaknessCategory: 'tactical' },
  });
  el('settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    localStorage.setItem('m9-browser-preview-settings', JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));
    renderDevProfile();
  });
}

function show(page) {
  const profile = page === 'profile';
  el('practice-page').classList.toggle('hidden', profile);
  el('profile-page').classList.toggle('hidden', !profile);
  el('nav-practice').classList.toggle('active', !profile);
  el('nav-profile').classList.toggle('active', profile);
}

el('corpus-first-run')?.classList.add('hidden');
el('system-status').textContent = 'Browser preview shim • native SQLite not proven';
el('nav-practice').addEventListener('click', () => show('practice'));
el('nav-profile').addEventListener('click', () => show('profile'));
renderBoard();
renderDevProfile();
show(new URLSearchParams(location.search).get('page') === 'profile' ? 'profile' : 'practice');
