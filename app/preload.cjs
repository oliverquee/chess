const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('chessAnalyst', Object.freeze({
  getState: invoke('app:get-state'),
  startPractice: invoke('practice:start-targeted'),
  startNextPractice: invoke('practice:start-next'),
  playPracticeMove: invoke('practice:play-move'),
  completePractice: invoke('practice:complete'),
  importPgn: invoke('import:completed-pgn'),
  importArchive: invoke('import:completed-archive'),
  analyzeGame: invoke('analysis:completed-game'),
  setClaudeKey: invoke('secrets:set-claude-key'),
  hasClaudeKey: invoke('secrets:has-claude-key'),
  deleteClaudeKey: invoke('secrets:delete-claude-key'),
  openChessComTheme: invoke('theme:open-chesscom'),
}));
