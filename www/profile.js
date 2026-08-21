import { WEAKNESS_CATEGORIES } from '../data/themeMapping.js';
import { getTheme, themeOptions } from './themes.js';

const LABELS = Object.freeze({
  tactical: 'Tactical',
  king_safety: 'King safety',
  pawn_structure: 'Pawn structure',
  piece_activity: 'Piece activity',
  positional_judgment: 'Positional judgment',
  endgame_technique: 'Endgame technique',
  practical_time: 'Practical / time',
});

const AVATARS = Object.freeze([
  ['orange-tabby', '🐱 Orange tabby'],
  ['tuxedo', '😸 Tuxedo'],
  ['calico', '😺 Calico'],
  ['black-cat', '🐈‍⬛ Black cat'],
]);

export function engineDifficultyLabel(level) {
  const value = Number(level);
  if (value <= 4) return 'Gentle kitten';
  if (value <= 9) return 'Curious hunter';
  if (value <= 14) return 'Sharp tabby';
  if (value <= 18) return 'Fierce prowler';
  return 'Grandmaster cat';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString();
}

function weaknessBars(tally) {
  if (!tally.length) {
    return '<p class="empty-state">No weakness data yet — complete and analyze sessions to reveal your hunting pattern.</p>';
  }
  const counts = new Map(tally.map((item) => [item.category, Number(item.count)]));
  const max = Math.max(...counts.values(), 1);
  return `<div class="weakness-chart" role="img" aria-label="Weakness breakdown">${WEAKNESS_CATEGORIES.map((category) => {
    const count = counts.get(category) ?? 0;
    const width = Math.round((count / max) * 100);
    return `<div class="weakness-row"><div class="weakness-label"><span>${LABELS[category]}</span><strong>${count}</strong></div><div class="bar-track"><span class="bar-fill category-${category}" style="width:${width}%"></span></div></div>`;
  }).join('')}</div>`;
}

function recentSessions(sessions) {
  if (!sessions.length) {
    return '<p class="empty-state">No sessions yet — tap Pounce on Weakness to start your first hunt.</p>';
  }
  return `<ul class="recent-list">${sessions.map((session) => `<li><div><strong>${formatDate(session.date)}</strong><span>${escapeHtml(LABELS[session.seeded_weakness] ?? session.seeded_weakness ?? 'General practice')}</span></div><div class="session-result"><strong>${escapeHtml(session.result ?? 'Completed')}</strong><span>${Number(session.move_count ?? 0)} moves</span></div></li>`).join('')}</ul>`;
}

export function renderProfile({ container, stats, settings, corpusStatus, focus }) {
  if (!container) throw new TypeError('profile container is required.');
  const level = Number(settings.engine_skill_level ?? 10);
  const avatarOptions = AVATARS.map(([value, label]) => `<option value="${value}"${settings.cat_avatar === value ? ' selected' : ''}>${label}</option>`).join('');
  const enoughProgress = stats.totalSessions >= 3;
  const activeTheme = getTheme(settings.theme);
  container.innerHTML = `
    <section class="profile-hero">
      <span class="profile-avatar">${activeTheme.emoji}</span>
      <div><h2>${escapeHtml(settings.display_name || 'Your Cat Analyst Profile')}</h2><p>${stats.totalSessions ? `${stats.totalSessions} hunts completed` : 'Your training story starts here.'}</p></div>
    </section>
    <section class="profile-card" aria-labelledby="stats-heading">
      <h2 id="stats-heading">Stats</h2>
      <div class="stat-grid"><div><strong>${stats.totalSessions}</strong><span>Sessions</span></div><div><strong>${stats.totalMoves}</strong><span>Moves logged</span></div></div>
      <h3>Current focus</h3>
      <p class="focus-pill">${focus?.weaknessCategory ? escapeHtml(LABELS[focus.weaknessCategory] ?? focus.weaknessCategory) : 'No focus yet'}</p>
      <h3>Weakness breakdown</h3>${weaknessBars(stats.weaknessTally)}
      <h3>Recent sessions</h3>${recentSessions(stats.recentSessions)}
      <h3>Progress over time</h3>
      ${enoughProgress ? '<p class="progress-ready">Progress tracking is unlocked. More analyzed sessions will make trends clearer.</p>' : '<p class="empty-state">Complete at least 3 sessions to unlock progress-over-time insights.</p>'}
    </section>
    <section class="profile-card" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <form id="settings-form" class="settings-form">
        <label>Display name<input name="display_name" maxlength="40" value="${escapeHtml(settings.display_name)}" autocomplete="name"></label>
        <label>Cat avatar<select name="cat_avatar">${avatarOptions}</select></label>
        <label>chess.com username<input name="chesscom_username" maxlength="50" value="${escapeHtml(settings.chesscom_username)}" autocomplete="off"></label>
        <label>Engine difficulty <span id="engine-difficulty-label">${engineDifficultyLabel(level)}</span><input name="engine_skill_level" type="range" min="0" max="20" step="1" value="${level}"><output id="engine-level-output">${level}</output></label>
        <label>Animal theme<select name="theme">${themeOptions(settings.theme)}</select></label>
        <button class="btn btn-primary" type="submit">Save settings</button>
      </form>
      <div class="corpus-status"><h3>Puzzle corpus</h3><p>${corpusStatus.populated ? `Version ${escapeHtml(corpusStatus.version ?? 'unknown')} • ${corpusStatus.puzzleCount.toLocaleString()} puzzles` : 'Not downloaded yet'}</p><button id="btn-corpus-update" class="btn btn-secondary" type="button">${corpusStatus.populated ? 'Re-download corpus' : 'Download corpus'}</button></div>
      <div class="danger-zone"><h3>Reset all data</h3><p>Deletes your sessions, move history, weakness data, and settings. The downloaded puzzle corpus is kept.</p><button id="btn-reset-data" class="btn btn-danger" type="button">Reset all training data</button></div>
    </section>`;
}
