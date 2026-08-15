export const IPC_CHANNELS = Object.freeze({
  getState: 'app:get-state',
  startPractice: 'practice:start-targeted',
  startNextPractice: 'practice:start-next',
  playPracticeMove: 'practice:play-move',
  completePractice: 'practice:complete',
  importPgn: 'import:completed-pgn',
  importArchive: 'import:completed-archive',
  analyzeGame: 'analysis:completed-game',
  setClaudeKey: 'secrets:set-claude-key',
  hasClaudeKey: 'secrets:has-claude-key',
  deleteClaudeKey: 'secrets:delete-claude-key',
  openChessComTheme: 'theme:open-chesscom',
});

export function secureWebPreferences(preload) {
  return Object.freeze({
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
}

export function remoteThemeWebPreferences() {
  return Object.freeze({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: 'persist:chesscom-theme',
  });
}

export function isAllowedChessComUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'chess.com' || url.hostname.endsWith('.chess.com'));
  } catch {
    return false;
  }
}
