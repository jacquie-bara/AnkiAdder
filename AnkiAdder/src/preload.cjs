const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('ankiAdder', {
  settings: () => invoke('settings:get'), saveSettings: input => invoke('settings:save', input),
  history: () => invoke('history:list'), checkAnki: () => invoke('anki:check'),
  deleteHistory: id => invoke('history:delete', id), entryDecks: id => invoke('anki:entry-decks', id),
  restore: (id, kind) => invoke('word:restore', id, kind),
  edit: (id, entry) => invoke('word:edit', id, entry),
  generate: word => invoke('word:generate', word), cancel: () => invoke('word:cancel'),
  regenerateText: id => invoke('word:regenerate-text', id),
  batch: () => invoke('batch:get'), startBatch: words => invoke('batch:start', words),
  resumeBatch: (retryFailed = false) => invoke('batch:resume', retryFailed), stopBatch: () => invoke('batch:stop'),
  add: (id, replaceExisting = false, deck) => invoke('anki:add', id, replaceExisting, deck), audio: (id, regenerate = false) => invoke('word:audio', id, regenerate), openLink: name => invoke('external:open', name),
});
