import { IPC_CHANNELS } from './security.js';

export function isTrustedIpcEvent(event) {
  return event?.senderFrame?.url?.startsWith('file:') === true;
}

export function registerIpcHandlers({ ipcMain, controller, openChessComTheme }) {
  const handlers = new Map([
    [IPC_CHANNELS.getState, () => controller.getState()],
    [IPC_CHANNELS.startPractice, (_event, payload) => controller.startPractice(payload)],
    [IPC_CHANNELS.startNextPractice, () => controller.startNextPractice()],
    [IPC_CHANNELS.playPracticeMove, (_event, payload) => controller.playPracticeMove(payload)],
    [IPC_CHANNELS.completePractice, (_event, payload) => controller.completePractice(payload)],
    [IPC_CHANNELS.importPgn, (_event, payload) => controller.importPgn(payload)],
    [IPC_CHANNELS.importArchive, (_event, payload) => controller.importArchive(payload)],
    [IPC_CHANNELS.analyzeGame, (_event, payload) => controller.analyzeGame(payload)],
    [IPC_CHANNELS.setClaudeKey, (_event, payload) => controller.setClaudeKey(payload)],
    [IPC_CHANNELS.hasClaudeKey, () => controller.hasClaudeKey()],
    [IPC_CHANNELS.deleteClaudeKey, () => controller.deleteClaudeKey()],
    [IPC_CHANNELS.openChessComTheme, () => openChessComTheme()],
  ]);
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (event, payload) => {
      if (!isTrustedIpcEvent(event)) throw new Error('IPC request rejected from an untrusted renderer.');
      return handler(event, payload);
    });
  }
  return () => {
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
  };
}
