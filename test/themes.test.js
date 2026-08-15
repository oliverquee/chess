import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyThemeToDocument,
  chessComThemeCss,
  resolveTheme,
  THEME_PACKS,
  themeCssVariables,
  validateThemePack,
} from '../app/themes/registry.js';

test('cat and panda are complete validated data packs with placeholder artwork', () => {
  assert.deepEqual(THEME_PACKS.map((theme) => theme.id), ['cat', 'panda']);
  for (const theme of THEME_PACKS) {
    assert.equal(validateThemePack(theme), theme);
    assert.equal(theme.artworkStatus, 'placeholder');
    assert.equal(Object.keys(theme.pieces).length, 12);
    assert.equal(Object.keys(themeCssVariables(theme)).length, 11);
  }
});

test('missing or broken themes fall back to cat without throwing', () => {
  const broken = { id: 'broken', name: 'Broken', tokens: {}, pieces: {} };
  assert.equal(resolveTheme('missing').id, 'cat');
  assert.equal(resolveTheme('broken', [broken, ...THEME_PACKS]).id, 'cat');
  const injected = {
    ...THEME_PACKS[0],
    id: 'injected',
    tokens: { ...THEME_PACKS[0].tokens, accent: 'red; background:url(javascript:alert(1))' },
  };
  assert.throws(() => validateThemePack(injected), /six-digit hex color/);
  assert.equal(resolveTheme('injected', [injected, ...THEME_PACKS]).id, 'cat');
});

test('theme application changes tokens and piece data without chess state', () => {
  const values = new Map();
  const document = {
    documentElement: {
      dataset: {},
      style: { setProperty: (name, value) => values.set(name, value) },
    },
  };
  const applied = applyThemeToDocument(document, resolveTheme('panda'));
  assert.equal(applied.id, 'panda');
  assert.equal(document.documentElement.dataset.theme, 'panda');
  assert.equal(values.get('--board-dark'), '#587460');
  assert.equal(applied.pieces.K, '♔');
});

test('chess.com theme output is CSS-only and carries selected palette', () => {
  const css = chessComThemeCss(resolveTheme('panda'));
  assert.match(css, /#edf2ec/);
  assert.match(css, /#587460/);
  assert.doesNotMatch(css, /javascript:|executeJavaScript|fen|stockfish|analysis/i);
});

test('theme module has no dependency on training, game, analysis, import, or storage logic', () => {
  const source = readFileSync(new URL('../app/themes/registry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.\.\/\.\.\/(?:core|engine|analysis|import|storage)\//);
  const renderer = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /applyThemeToDocument/);
  assert.match(renderer, /activeTheme\.pieces/);
});
