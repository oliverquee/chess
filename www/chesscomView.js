export const CHESSCOM_URL = 'https://www.chess.com/play/online';
export const THEME_STYLE_ID = 'cat-analyst-theme-overlay';

/**
 * Theme-only injection. This script writes one style element and deliberately
 * returns no page data to the host app.
 */
export function buildThemeInjectionScript(css) {
  if (typeof css !== 'string' || !css.trim()) throw new TypeError('Chess.com theme CSS is required.');
  return `(() => {
    if (document.head) {
      const style = document.getElementById(${JSON.stringify(THEME_STYLE_ID)}) || document.createElement('style');
      style.id = ${JSON.stringify(THEME_STYLE_ID)};
      style.textContent = ${JSON.stringify(css)};
      if (!style.isConnected) document.head.appendChild(style);
    }
  })();`;
}

/**
 * Owns the native embedded browser lifecycle. The only script execution is
 * buildThemeInjectionScript(); no DOM content is read back into this app.
 */
export function createChessComView({ inAppBrowser, themeCss, browserOptions = {} }) {
  if (!inAppBrowser?.openWebView || !inAppBrowser?.executeScript || !inAppBrowser?.addListener) {
    throw new TypeError('A controllable embedded in-app browser is required.');
  }

  let currentThemeCss = themeCss;
  let browserId = null;
  let listenersReady = false;

  async function inject(event = {}) {
    if (!browserId || (event.id && event.id !== browserId)) return;
    await inAppBrowser.executeScript({ id: browserId, code: buildThemeInjectionScript(currentThemeCss) });
  }

  async function ensureListeners() {
    if (listenersReady) return;
    listenersReady = true;
    await inAppBrowser.addListener('browserPageLoaded', (event) => { void inject(event); });
    await inAppBrowser.addListener('urlChangeEvent', (event) => { void inject(event); });
    await inAppBrowser.addListener('closeEvent', (event) => {
      if (!event.id || event.id === browserId) browserId = null;
    });
  }

  return {
    get browserId() { return browserId; },
    get injectionScript() { return buildThemeInjectionScript(currentThemeCss); },
    async setThemeCss(css) {
      currentThemeCss = css;
      if (browserId) await inject({ id: browserId });
    },
    async open() {
      await ensureListeners();
      if (browserId && inAppBrowser.show) {
        await inAppBrowser.show({ id: browserId });
        await inject({ id: browserId });
        return browserId;
      }
      const result = await inAppBrowser.openWebView({
        url: CHESSCOM_URL,
        persistWebViewData: true,
        isPresentAfterPageLoad: true,
        preShowScript: buildThemeInjectionScript(currentThemeCss),
        preShowScriptInjectionTime: 'pageLoad',
        ...browserOptions,
      });
      browserId = result.id;
      await inject({ id: browserId });
      return browserId;
    },
  };
}
