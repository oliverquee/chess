const STANDARD_PIECES = Object.freeze({
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
});

export const THEME_PACKS = Object.freeze([
  Object.freeze({
    id: 'cat',
    name: 'Woodland Cat',
    artworkStatus: 'placeholder',
    tokens: Object.freeze({
      ink: '#20302a', muted: '#6e756f', background: '#f4efe5', panel: '#fffdf8',
      accent: '#315c4c', accentText: '#ffffff', highlight: '#d4a94f', border: '#d9d4c9',
      boardLight: '#e8dfc7', boardDark: '#6f907e', boardFrame: '#25382f',
    }),
    pieces: STANDARD_PIECES,
  }),
  Object.freeze({
    id: 'panda',
    name: 'Bamboo Panda',
    artworkStatus: 'placeholder',
    tokens: Object.freeze({
      ink: '#1f2925', muted: '#68716d', background: '#edf2ec', panel: '#fbfdf9',
      accent: '#3f684d', accentText: '#ffffff', highlight: '#d3ad55', border: '#cdd8cf',
      boardLight: '#dce8d7', boardDark: '#587460', boardFrame: '#202a25',
    }),
    pieces: STANDARD_PIECES,
  }),
]);

const TOKEN_KEYS = Object.freeze([
  'ink', 'muted', 'background', 'panel', 'accent', 'accentText', 'highlight',
  'border', 'boardLight', 'boardDark', 'boardFrame',
]);
const PIECE_KEYS = Object.freeze(['p', 'r', 'n', 'b', 'q', 'k', 'P', 'R', 'N', 'B', 'Q', 'K']);

export function validateThemePack(theme) {
  if (!theme || typeof theme !== 'object') throw new TypeError('theme must be an object.');
  if (!/^[a-z][a-z0-9-]*$/.test(theme.id ?? '')) throw new TypeError('theme.id must be a safe identifier.');
  if (typeof theme.name !== 'string' || !theme.name) throw new TypeError('theme.name is required.');
  for (const key of TOKEN_KEYS) {
    if (!/^#[0-9a-f]{6}$/i.test(theme.tokens?.[key] ?? '')) {
      throw new TypeError(`theme.tokens.${key} must be a six-digit hex color.`);
    }
  }
  for (const key of PIECE_KEYS) {
    if (typeof theme.pieces?.[key] !== 'string' || !theme.pieces[key]) throw new TypeError(`theme.pieces.${key} is required.`);
  }
  return theme;
}

export function resolveTheme(themeId, packs = THEME_PACKS) {
  const valid = packs.filter((pack) => {
    try { validateThemePack(pack); return true; } catch { return false; }
  });
  return valid.find((pack) => pack.id === themeId) ?? valid.find((pack) => pack.id === 'cat') ?? THEME_PACKS[0];
}

export function themeCssVariables(theme) {
  const selected = validateThemePack(theme);
  return Object.freeze({
    '--ink': selected.tokens.ink,
    '--muted': selected.tokens.muted,
    '--cream': selected.tokens.background,
    '--paper': selected.tokens.panel,
    '--green': selected.tokens.accent,
    '--accent-text': selected.tokens.accentText,
    '--gold': selected.tokens.highlight,
    '--line': selected.tokens.border,
    '--board-light': selected.tokens.boardLight,
    '--board-dark': selected.tokens.boardDark,
    '--board-frame': selected.tokens.boardFrame,
  });
}

export function applyThemeToDocument(document, theme) {
  const selected = resolveTheme(theme?.id, [theme, ...THEME_PACKS]);
  for (const [name, value] of Object.entries(themeCssVariables(selected))) {
    document.documentElement.style.setProperty(name, value);
  }
  document.documentElement.dataset.theme = selected.id;
  return selected;
}

export function chessComThemeCss(theme) {
  const selected = resolveTheme(theme?.id, [theme, ...THEME_PACKS]);
  const { tokens } = selected;
  return `
:root { --chess-analyst-accent: ${tokens.accent}; }
body { background-color: ${tokens.background} !important; }
.board .light { background-color: ${tokens.boardLight} !important; }
.board .dark { background-color: ${tokens.boardDark} !important; }
button, [role="button"] { border-radius: 10px !important; }
`;
}
