const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const { regenerateRecord, restoreRecord } = require('../src/records.cjs');
const { addToAnki, entryDecks, DEFAULTS, FIELDS, MODEL_NAME } = require('../src/core.cjs');
const fixture = require('./fixture.cjs');

test('independent text/audio undo survives restart, retains costs and refuses renamed-word audio', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-undo-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, {}); await store.load();
  const original = { id: 'one', entry: fixture, model: DEFAULTS.model, noteId: 1, sourceLanguage: 'Spanish', translationLanguage: 'English', costs: { text: { usd: 1 }, pronunciation: { usd: 2 } }, audio: { filename: 'old.mp3' } };
  const updated = regenerateRecord(original, { ...fixture, notes: 'New notes' }, DEFAULTS.model, [{ usd: 3 }]);
  updated.audioVersions = [{ audio: original.audio, lemma: fixture.lemma }]; updated.audio = { filename: 'new.mp3' };
  await store.put(updated);
  const reopened = new Store(directory, {}); await reopened.load();
  const text = restoreRecord(reopened.history[0], 'text');
  assert.deepEqual(text.entry, original.entry); assert.equal(text.audio.filename, 'new.mp3');
  const audio = restoreRecord(text, 'audio');
  assert.equal(audio.audio.filename, 'old.mp3'); assert(audio.pendingAnkiChanges);
  assert.deepEqual(audio.costs, updated.costs); assert.equal(audio.textVersions.length, 0);
  assert.throws(() => restoreRecord(audio, 'audio'), /No previous/);
  assert.throws(() => restoreRecord({ ...updated, entry: { ...fixture, lemma: 'renamed' } }, 'audio'), /renamed/);
});

test('deleting history persists, preserves other words and keeps memory unchanged on disk failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-delete-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, {}); await store.load();
  await store.put({ id: 'one', entry: fixture }); await store.put({ id: 'two', entry: fixture });
  await store.remove('one');
  const reopened = new Store(directory, {}); await reopened.load(); assert.deepEqual(reopened.history.map(item => item.id), ['two']);
  store.write = async () => { throw new Error('disk full'); };
  await assert.rejects(store.remove('two'), /disk full/); assert.equal(store.history.length, 1);
});

test('deck membership uses live cards, adds separate copies, skips exact-deck duplicates and updates all copies', async () => {
  const notes = new Map([[10, { deck: 'Swedish', fields: {} }]]), calls = [];
  const mock = async (_url, options) => {
    const r = JSON.parse(options.body); calls.push(r); let result = null;
    if (r.action === 'modelNames') result = [MODEL_NAME];
    if (r.action === 'modelFieldNames') result = FIELDS;
    if (r.action === 'findNotes') result = [...notes.keys()];
    if (r.action === 'notesInfo') result = r.params.notes.map(id => ({ cards: [id], fields: Object.fromEntries(Object.entries(notes.get(id).fields).map(([name, value]) => [name, { value }])) }));
    if (r.action === 'cardsInfo') result = r.params.cards.map(id => ({ note: id, deckName: notes.get(id).deck }));
    if (r.action === 'addNote') { result = 11; notes.set(result, { deck: r.params.note.deckName, fields: r.params.note.fields }); }
    if (r.action === 'updateNoteFields') Object.assign(notes.get(r.params.note.id).fields, r.params.note.fields);
    return { ok: true, json: async () => ({ result, error: null }) };
  };
  const settings = { ...DEFAULTS, deck: 'Swedish::日本語 "quoted"' }, record = { entry: fixture, sourceLanguage: DEFAULTS.sourceLanguage, translationLanguage: DEFAULTS.translationLanguage };
  assert.deepEqual(await entryDecks(record, settings, '', mock), ['Swedish']);
  assert.equal((await addToAnki(fixture, settings, '', mock)).noteId, 11);
  assert.deepEqual(await entryDecks(record, settings, '', mock), ['Swedish', settings.deck]);
  assert((await addToAnki(fixture, settings, '', mock)).duplicate);
  assert.equal(calls.filter(call => call.action === 'addNote').length, 1);
  const note = calls.find(call => call.action === 'addNote').params.note;
  assert.equal(note.options.duplicateScope, 'deck'); assert.equal(note.options.duplicateScopeOptions.checkChildren, false);
  await addToAnki({ ...fixture, notes: 'Corrected text' }, settings, '', mock, { replaceExisting: true });
  assert.deepEqual(calls.filter(call => call.action === 'updateNoteFields').map(call => call.params.note.id), [10, 11]);
  assert.equal(notes.get(10).deck, 'Swedish');
  assert(!calls.some(call => ['deleteNotes', 'changeDeck'].includes(call.action)));
  notes.get(10).deck = 'Moved manually';
  assert((await entryDecks(record, settings, '', mock)).includes('Moved manually'));
});
