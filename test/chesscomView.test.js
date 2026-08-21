import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHESSCOM_URL, THEME_STYLE_ID, buildThemeInjectionScript, createChessComView } from '../www/chesscomView.js';

const CSS = readFileSync(new URL('../www/chesscom-theme.css', import.meta.url), 'utf8');

function mockBrowser() {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    listeners,
    async addListener(name, callback) { listeners.set(name, callback); calls.push(['listen', name]); },
    async openWebView(options) { calls.push(['open', options]); return { id: 'chess-view' }; },
    async executeScript(options) { calls.push(['script', options]); },
    async show(options) { calls.push(['show', options]); },
  };
}

test('M9 addendum injection is idempotent style-only code with no extraction path', () => {
  const script = buildThemeInjectionScript(CSS);
  assert.match(script, new RegExp(THEME_STYLE_ID));
  assert.match(script, /createElement\('style'\)/);
  assert.match(script, /style\.textContent\s*=/);
  assert.match(script, /document\.head\.appendChild/);
  assert.doesNotMatch(script, /querySelector|innerHTML|outerHTML|getAttribute|postMessage|fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  assert.doesNotMatch(script, /return\s+document|return\s+style|return\s+window/);
});

test('M9 addendum opens an embedded persistent WebView and re-injects after navigation', async () => {
  const browser = mockBrowser();
  const view = createChessComView({
    inAppBrowser: browser,
    themeCss: CSS,
    browserOptions: { toolbarType: 'navigation', closeAction: 'hide' },
  });

  assert.equal(await view.open(), 'chess-view');
  const open = browser.calls.find(([kind]) => kind === 'open')[1];
  assert.equal(open.url, CHESSCOM_URL);
  assert.equal(open.persistWebViewData, true);
  assert.equal(open.isPresentAfterPageLoad, true);
  assert.equal(open.preShowScript, view.injectionScript);
  assert.ok(browser.listeners.has('browserPageLoaded'));
  assert.ok(browser.listeners.has('urlChangeEvent'));

  await browser.listeners.get('urlChangeEvent')({ id: 'chess-view', url: 'https://www.chess.com/game/live' });
  await new Promise((resolve) => setImmediate(resolve));
  const scripts = browser.calls.filter(([kind]) => kind === 'script');
  assert.ok(scripts.length >= 2, 'initial load and SPA navigation should both inject the theme');

  await view.open();
  assert.ok(browser.calls.some(([kind]) => kind === 'show'), 'hidden WebView should be reused with its persistent session');
});

test('M9 addendum source never calls browser data-return or messaging APIs', () => {
  const source = readFileSync(new URL('../www/chesscomView.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getCookies|messageFromWebview|postMessage|takeScreenshot|consoleMessage|executeScript\([^)]*result/);
});
