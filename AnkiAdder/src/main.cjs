const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { AudioCache } = require('./audio.cjs');
const { calculate, zero } = require('./ui/pricing.js');
const { generateEntry, addToAnki, ankiCall, buildNote } = require('./core.cjs');
const { editRecord } = require('./records.cjs');

const page = path.join(__dirname, 'ui', 'index.html');
const allowedLinks = { anki: 'https://apps.ankiweb.net/', addon: 'https://ankiweb.net/shared/info/2055492159', keys: 'https://platform.openai.com/api-keys', pricing: 'https://developers.openai.com/api/docs/pricing', usage: 'https://platform.openai.com/usage' };
let store, audioCache, generation, mutation = false;
if (process.env.ANKIADDER_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.ANKIADDER_TEST_DATA);
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(page).href) return { ok: false, error: 'Untrusted request.' };
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'Generation cancelled.' : e.name === 'TimeoutError' ? 'Generation timed out. Please try again.' : e.message || 'Something went wrong. Please try again.' }; }
  });
}
async function attachAudio(record, signal) {
  const audio = await audioCache.ensure(record.entry.lemma, record.sourceLanguage, record.audio?.voice || store.settings.voice, () => store.secret('apiKey'), signal);
  const previous = record.costs?.pronunciation;
  // Playback must not replace the original paid receipt with a $0 cache hit.
  const cost = audio.cost.basis === 'cached' && record.audio ? (previous || calculate('gpt-4o-mini-tts', undefined)) : audio.cost;
  const { cost: _cost, ...metadata } = audio;
  return store.put({ ...record, audio: metadata, costs: { ...record.costs, pronunciation: cost } });
}
async function add(id, replaceExisting = false) {
  if (mutation) throw new Error('An operation is already in progress.');
  let record = store.history.find(item => item.id === id);
  if (!record) throw new Error('This entry could not be found.');
  mutation = true;
  try {
    const settings = { ...store.settings, sourceLanguage: record.sourceLanguage, translationLanguage: record.translationLanguage };
    if (settings.audioEnabled && !record.audio && !(replaceExisting && record.editedAt)) record = await attachAudio(record);
    const audio = settings.audioEnabled && record.audio ? await audioCache.read(record.audio.filename) : undefined;
    const result = await addToAnki(record.entry, settings, store.secret('ankiKey'), fetch, { audio, replaceExisting: replaceExisting === true, previousIdentity: record.ankiIdentity, clearAudio: record.audioInvalidated === true });
    return await store.put({ ...record, status: result.duplicate ? 'duplicate' : result.updated ? 'updated' : 'added', noteId: result.noteId, ankiIdentity: buildNote(record.entry, settings).fields.Identity, pendingAnkiChanges: result.duplicate ? Boolean(record.pendingAnkiChanges) : false, audioInvalidated: result.duplicate ? record.audioInvalidated : false, ...(result.duplicate || result.updated ? {} : { deck: settings.deck }) });
  } finally { mutation = false; }
}
function createWindow() {
  const window = new BrowserWindow({ width: 1180, height: 850, minWidth: 760, minHeight: 600, icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'), backgroundColor: '#f6f7f2', show: !process.argv.includes('--smoke-test'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.loadFile(page);
}
app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.ankiadder.desktop');
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'assets/icon.png'));
  store = new Store(app.getPath('userData'), safeStorage);
  audioCache = new AudioCache(app.getPath('userData'));
  await store.load();
  handle('settings:get', () => store.publicSettings());
  handle('settings:save', async input => {
    if (mutation || generation) throw new Error('Wait for the current operation before changing settings.');
    mutation = true;
    try { return await store.save(input); } finally { mutation = false; }
  });
  handle('history:list', () => store.history);
  handle('word:edit', async (id, entry) => {
    if (mutation || generation) throw new Error('Wait for the current operation before saving edits.');
    const record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This saved entry could not be found.');
    mutation = true;
    try { return await store.put(editRecord(record, entry)); } finally { mutation = false; }
  });
  handle('anki:check', async () => {
    const version = await ankiCall(store.settings, store.secret('ankiKey'), 'version');
    if (version < 6) throw new Error('Update AnkiConnect to a version supporting API version 6.');
    const names = await ankiCall(store.settings, store.secret('ankiKey'), 'deckNames');
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Anki returned an unreadable deck list. Refresh after opening a profile.');
    return { decks: [...new Set(names)].sort((a, b) => a.localeCompare(b)) };
  });
  handle('word:generate', async word => {
    if (generation || mutation) throw new Error('An operation is already in progress.');
    const settings = { ...store.settings };
    const controller = new AbortController(); generation = controller;
    try {
      let textCost = calculate(settings.model, undefined);
      const entry = await generateEntry(word, settings, store.secret('apiKey'), { signal: controller.signal, onUsage: (usage, tier) => { textCost = calculate(settings.model, usage, tier); } });
      let record = await store.put({ id: randomUUID(), createdAt: new Date().toISOString(), sourceLanguage: settings.sourceLanguage, translationLanguage: settings.translationLanguage, model: settings.model, format: 'compact', entry, status: 'draft', costs: { text: textCost, pronunciation: settings.audioEnabled ? calculate('gpt-4o-mini-tts', undefined) : zero('off') } });
      if (settings.audioEnabled) {
        try { record = await attachAudio(record, controller.signal); }
        catch (e) { return { record, addError: e.name === 'AbortError' ? 'Pronunciation cancelled. Your text entry is saved; generate its audio when ready.' : e.message }; }
      }
      if (settings.autoAdd && !entry.warnings.length) {
        try { return { record: await add(record.id) }; }
        catch (e) { return { record, addError: e.message }; }
      }
      return { record, ...(settings.autoAdd && entry.warnings.length ? { addError: 'The model flagged uncertainty. Review the entry before adding it.' } : {}) };
    } finally { generation = undefined; }
  });
  handle('word:cancel', () => generation?.abort());
  handle('anki:add', add);
  handle('word:audio', async id => {
    if (mutation || generation) throw new Error('Wait for the current operation before playing pronunciation.');
    if (!store.settings.audioEnabled) throw new Error('Turn on pronunciation to generate or play audio.');
    let record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This entry could not be found.');
    mutation = true;
    try {
      record = await attachAudio(record);
      const audio = await audioCache.read(record.audio.filename);
      return { record, src: `data:audio/mpeg;base64,${audio.data}` };
    } finally { mutation = false; }
  });
  handle('external:open', name => { if (!allowedLinks[name]) throw new Error('Unknown link.'); return shell.openExternal(allowedLinks[name]); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'AnkiAdder', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { dialog.showErrorBox('AnkiAdder could not start', error.message); app.quit(); });
app.on('window-all-closed', () => { generation?.abort(); if (process.platform !== 'darwin') app.quit(); });
