const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('ankiAdder', {
  settings: () => invoke('settings:get'), saveSettings: input => invoke('settings:save', input),
  history: () => invoke('history:list'), checkAnki: () => invoke('anki:check'),
  edit: (id, entry) => invoke('word:edit', id, entry),
  generate: word => invoke('word:generate', word), cancel: () => invoke('word:cancel'),
  add: (id, replaceExisting = false) => invoke('anki:add', id, replaceExisting), audio: id => invoke('word:audio', id), openLink: name => invoke('external:open', name),
});
