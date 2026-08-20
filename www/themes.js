export const THEMES = Object.freeze({
  cat: Object.freeze({ label: 'Orange cat', emoji: '🐱', subtitle: 'Orange Tabby Edition 🐾', engine: 'Orange Cat' }),
  panda: Object.freeze({ label: 'Panda', emoji: '🐼', subtitle: 'Bamboo Panda Edition 🎋', engine: 'Panda' }),
  'black-cat': Object.freeze({ label: 'Black cat', emoji: '🐈‍⬛', subtitle: 'Midnight Cat Edition 🌙', engine: 'Midnight Cat' }),
  bunny: Object.freeze({ label: 'Bunny', emoji: '🐰', subtitle: 'Berry Bunny Edition 🥕', engine: 'Bunny' }),
  fox: Object.freeze({ label: 'Fox', emoji: '🦊', subtitle: 'Woodland Fox Edition 🍂', engine: 'Fox' }),
});

export function getTheme(themeId) {
  return THEMES[themeId] ?? THEMES.cat;
}

export function themeOptions(selectedTheme = 'cat') {
  return Object.entries(THEMES).map(([value, theme]) =>
    `<option value="${value}"${value === selectedTheme ? ' selected' : ''}>${theme.emoji} ${theme.label}</option>`,
  ).join('');
}

export function applyAppTheme(themeId, root = document.documentElement) {
  const id = THEMES[themeId] ? themeId : 'cat';
  const theme = THEMES[id];
  root.dataset.theme = id;
  document.querySelector('.brand-avatar')?.replaceChildren(theme.emoji);
  const subtitle = document.querySelector('.brand-sub');
  if (subtitle) subtitle.textContent = theme.subtitle;
  const firstRun = document.querySelector('.first-run-cat');
  if (firstRun) firstRun.textContent = theme.emoji;
  return theme;
}

const CHESSCOM_COLORS = Object.freeze({
  cat: ['#E67E22', '#D35400', '#F7EFE2', '#C8854E', '#7A4526'],
  panda: ['#2F855A', '#276749', '#F7FAF7', '#7BAE7F', '#202A24'],
  'black-cat': ['#9F7AEA', '#6B46C1', '#E9E6F2', '#4B4658', '#17151D'],
  bunny: ['#E96B9A', '#C44575', '#FFF4F7', '#DFA2B8', '#71495A'],
  fox: ['#E76F31', '#B94718', '#FFF1DF', '#C76B3D', '#66321F'],
});

export function chessComCssForTheme(baseCss, themeId) {
  const colors = CHESSCOM_COLORS[themeId] ?? CHESSCOM_COLORS.cat;
  return `${baseCss}\n:root {
    --chess-analyst-accent: ${colors[0]};
    --chess-analyst-accent-dark: ${colors[1]};
    --chess-analyst-board-light: ${colors[2]};
    --chess-analyst-board-dark: ${colors[3]};
    --chess-analyst-board-frame: ${colors[4]};
    --chess-analyst-highlight: color-mix(in srgb, ${colors[0]} 48%, transparent);
  }`;
}
