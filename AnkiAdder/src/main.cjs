const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu, powerSaveBlocker } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { AudioCache } = require('./audio.cjs');
const { calculate, combine, zero } = require('./ui/pricing.js');
const { generateEntry, addToAnki, ankiCall, buildNote, entryDecks } = require('./core.cjs');
const { editRecord, regenerateRecord, restoreRecord } = require('./records.cjs');
const { BatchQueue } = require('./batch.cjs');

const page = path.join(__dirname, 'ui', 'index.html');
const allowedLinks = { anki: 'https://apps.ankiweb.net/', addon: 'https://ankiweb.net/shared/info/2055492159', keys: 'https://platform.openai.com/api-keys', pricing: 'https://developers.openai.com/api/docs/pricing', usage: 'https://platform.openai.com/usage' };
let store, audioCache, generation, batch, mutation = false;
if (process.env.ANKIADDER_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.ANKIADDER_TEST_DATA);
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(page).href) return { ok: false, error: 'Untrusted request.' };
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'Generation cancelled.' : e.name === 'TimeoutError' ? 'Generation timed out. Please try again.' : e.message || 'Something went wrong. Please try again.' }; }
  });
}
async function attachAudio(record, signal, regenerate = false, settings = store.settings) {
  if (record.audio && !regenerate) {
    try { await audioCache.read(record.audio.filename); return record; }
    catch (e) { if (!e.message.includes('file is missing')) throw e; }
  }
  const audio = await audioCache.ensure(record.entry.lemma, record.sourceLanguage, record.audio?.voice || settings.voice, () => store.secret('apiKey'), signal, { regenerate: regenerate || Boolean(record.audio) });
  const previous = record.costs?.pronunciation;
  // Playback must not replace the original paid receipt with a $0 cache hit.
  let cost = audio.cost.basis === 'cached' && record.audio ? (previous || calculate('gpt-4o-mini-tts', undefined)) : audio.cost;
  if (record.audio && previous && audio.cost.basis !== 'cached') {
    const receipts = previous.receipts || [previous];
    cost = { usd: previous.usd == null || audio.cost.usd == null ? null : previous.usd + audio.cost.usd, basis: 'requests', receipts: [...receipts, audio.cost] };
  }
  const { cost: _cost, ...metadata } = audio;
  return store.put({ ...record, ...(record.audio ? { audioVersions: [...(record.audioVersions || []), { audio: record.audio, audioInvalidated: record.audioInvalidated, lemma: record.entry.lemma }] } : {}), audio: metadata, costs: { ...record.costs, pronunciation: cost }, pendingAnkiChanges: record.pendingAnkiChanges || Boolean(record.noteId), audioInvalidated: false });
}
async function add(id, replaceExisting = false, chosenSettings = store.settings) {
  if (mutation) throw new Error('An operation is already in progress.');
  let record = store.history.find(item => item.id === id);
  if (!record) throw new Error('This entry could not be found.');
  mutation = true;
  try {
    const settings = { ...chosenSettings, sourceLanguage: record.sourceLanguage, translationLanguage: record.translationLanguage };
    if (settings.audioEnabled && !record.audio && !(replaceExisting && record.editedAt)) record = await attachAudio(record, undefined, false, settings);
    const audio = settings.audioEnabled && record.audio ? await audioCache.read(record.audio.filename) : undefined;
    const result = await addToAnki(record.entry, settings, store.secret('ankiKey'), fetch, { audio, replaceExisting: replaceExisting === true, previousIdentity: record.ankiIdentity, clearAudio: record.audioInvalidated === true });
    return await store.put({ ...record, status: result.duplicate ? 'duplicate' : result.updated ? 'updated' : 'added', noteId: result.noteId, ankiIdentity: buildNote(record.entry, settings).fields.Identity, pendingAnkiChanges: result.duplicate || (!result.updated && record.noteId) ? Boolean(record.pendingAnkiChanges) : false, audioInvalidated: result.duplicate ? record.audioInvalidated : false, ...(result.duplicate || result.updated ? {} : { deck: settings.deck }) });
  } finally { mutation = false; }
}
async function generate(word, settings, batchItem) {
  const controller = new AbortController(); generation = controller;
  try {
    // A saved draft is also the checkpoint if the app quit between generation and addition.
    let record = batchItem && store.history.find(item => item.batchItemId === batchItem.id);
    if (record && record.status !== 'draft' && !record.pendingAnkiChanges) return { record };
    if (!record) {
      const textReceipts = [];
      const entry = await generateEntry(word, settings, store.secret('apiKey'), { signal: controller.signal, onUsage: (usage, tier) => { textReceipts.push(calculate(settings.model, usage, tier)); } });
      const textCost = combine(textReceipts);
      record = await store.put({ id: randomUUID(), ...(batchItem ? { batchItemId: batchItem.id } : {}), createdAt: new Date().toISOString(), sourceLanguage: settings.sourceLanguage, translationLanguage: settings.translationLanguage, model: settings.model, format: 'compact', entry, status: 'draft', costs: { text: textCost, pronunciation: settings.audioEnabled ? calculate('gpt-4o-mini-tts', undefined) : zero('off') } });
    }
    if (settings.audioEnabled) {
      try { record = await attachAudio(record, controller.signal, false, settings); }
      catch (e) { return { record, addError: e.name === 'AbortError' ? 'Pronunciation cancelled. Your text entry is saved; generate its audio when ready.' : e.message }; }
    }
    if (settings.autoAdd && !record.entry.warnings.length) {
      try { return { record: await add(record.id, false, settings) }; }
      catch (e) { return { record, addError: e.message }; }
    }
    return { record, ...(settings.autoAdd && record.entry.warnings.length ? { addError: 'The model flagged uncertainty. Review the entry before adding it.' } : {}) };
  } finally { generation = undefined; }
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
  batch = new BatchQueue({
    store,
    processItem: (item, settings) => generate(item.word, { ...settings, autoAdd: true }, item),
    preflight: async settings => {
      if (!store.secret('apiKey')) throw new Error('Add your OpenAI API key in Settings first.');
      const version = await ankiCall(settings, store.secret('ankiKey'), 'version');
      if (version < 6) throw new Error('Update AnkiConnect to a version supporting API version 6.');
    },
    keepAwake: () => { const id = powerSaveBlocker.start('prevent-app-suspension'); return () => powerSaveBlocker.stop(id); },
    onIdle: () => { if (process.platform !== 'darwin' && !BrowserWindow.getAllWindows().length) app.quit(); },
  });
  await batch.load();
  handle('settings:get', () => store.publicSettings());
  handle('settings:save', async input => {
    if (mutation || generation || batch.running) throw new Error('Wait for the current operation before changing settings.');
    mutation = true;
    try { return await store.save(input); } finally { mutation = false; }
  });
  handle('history:list', () => store.history);
  handle('history:delete', async id => {
    if (mutation || generation || batch.running) throw new Error('Wait for the current operation before deleting an entry.');
    mutation = true;
    try { await store.remove(id); } finally { mutation = false; }
  });
  handle('word:restore', async (id, kind) => {
    if (mutation || generation || batch.running) throw new Error('Wait for the current operation before restoring a version.');
    const record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This saved entry could not be found.');
    mutation = true;
    try {
      const restored = restoreRecord(record, kind);
      if (kind === 'audio' && restored.audio) await audioCache.read(restored.audio.filename);
      return await store.put(restored);
    } finally { mutation = false; }
  });
  handle('anki:entry-decks', id => {
    const record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This saved entry could not be found.');
    return entryDecks(record, store.settings, store.secret('ankiKey'));
  });
  handle('word:edit', async (id, entry) => {
    if (mutation || generation || batch.running) throw new Error('Wait for the current operation before saving edits.');
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
    if (generation || mutation || batch.running) throw new Error('An operation is already in progress.');
    return generate(word, { ...store.settings });
  });
  handle('word:regenerate-text', async id => {
    if (generation || mutation || batch.running) throw new Error('An operation is already in progress.');
    const record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This saved entry could not be found.');
    const settings = { ...store.settings, sourceLanguage: record.sourceLanguage, translationLanguage: record.translationLanguage };
    const controller = new AbortController(); generation = controller;
    const receipts = [];
    try {
      const entry = await generateEntry(record.entry.word, settings, store.secret('apiKey'), { targetLemma: record.entry.lemma, previousEntry: record.entry, signal: controller.signal, onUsage: (usage, tier) => receipts.push(calculate(settings.model, usage, tier)) });
      controller.signal.throwIfAborted();
      return await store.put(regenerateRecord(record, entry, settings.model, receipts));
    } finally { generation = undefined; }
  });
  handle('word:cancel', () => { if (!batch.running) generation?.abort(); });
  handle('batch:get', () => batch.snapshot());
  handle('batch:start', input => {
    if (generation || mutation) throw new Error('An operation is already in progress.');
    return batch.start(input, store.settings);
  });
  handle('batch:resume', retryFailed => {
    if (generation || mutation) throw new Error('An operation is already in progress.');
    return batch.resume(retryFailed === true);
  });
  handle('batch:stop', () => batch.stop());
  handle('anki:add', (id, replaceExisting, deck) => {
    if (generation || batch.running) throw new Error('Wait for the current operation before adding a card.');
    if (deck !== undefined && (typeof deck !== 'string' || !deck.trim() || deck.length > 200)) throw new Error('Choose a valid deck.');
    return add(id, replaceExisting, { ...store.settings, ...(deck ? { deck: deck.trim() } : {}) });
  });
  handle('word:audio', async (id, regenerate = false) => {
    if (typeof regenerate !== 'boolean') throw new Error('Invalid pronunciation request.');
    if (mutation || generation || batch.running) throw new Error('Wait for the current operation before playing pronunciation.');
    if (!store.settings.audioEnabled) throw new Error('Turn on pronunciation to generate or play audio.');
    let record = store.history.find(item => item.id === id);
    if (!record) throw new Error('This entry could not be found.');
    mutation = true;
    try {
      record = await attachAudio(record, undefined, regenerate);
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
app.on('window-all-closed', () => { if (!batch?.running) { generation?.abort(); if (process.platform !== 'darwin') app.quit(); } });
