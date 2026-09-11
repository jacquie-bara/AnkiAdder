const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, COMPACT_SCHEMA, validateSettings, validateAnkiUrl, validateEntry, generateEntry, buildNote, addToAnki, MODEL_NAME, FIELDS } = require('../src/core.cjs');
const { Store } = require('../src/store.cjs');
const fixture = require('./fixture.cjs');
const jsonResponse = data => ({ ok: true, json: async () => data });
const completed = entry => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(entry) }] }] });

test('local Anki URL validation rejects remote hosts, credentials, and alternate schemes', () => {
  for (const url of ['https://localhost:8765', 'http://example.com', 'file:///secret', 'http://user:pass@localhost', 'http://localhost/?x=1', 'http://localhost/path']) assert.throws(() => validateAnkiUrl(url));
  assert.equal(validateAnkiUrl('http://127.0.0.1:8765/'), DEFAULTS.ankiUrl);
  assert.equal(validateSettings({}).model, 'gpt-5.6-luna');
  assert.throws(() => validateSettings({ sourceLanguage: ' ' }));
});
test('every meaning must have exactly two nonempty translated examples', () => {
  assert.equal(validateEntry(fixture), fixture);
  const invalid = structuredClone(fixture); invalid.meanings[0].examples.pop();
  assert.throws(() => validateEntry(invalid), /exactly two/);
  invalid.meanings[0].examples.push({ sentence: '', translation: '' });
  assert.throws(() => validateEntry(invalid), /Example/);
  assert.throws(() => validateEntry({ ...fixture, meanings: [] }));
});
test('OpenAI request uses the selected model, strict schema, two examples, and no storage', async () => {
  let request;
  const result = await generateEntry('hablar', DEFAULTS, 'test-key', { fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return jsonResponse(completed(fixture)); } });
  assert.deepEqual(result, fixture);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.model, 'gpt-5.6-luna');
  assert.equal(request.body.store, false);
  assert.equal(request.body.max_output_tokens, 4000);
  assert.equal(request.body.reasoning.effort, 'low');
  assert.equal(request.body.text.format.schema.properties.meanings.maxItems, undefined);
  assert.equal(request.body.text.format.schema.properties.conjugations.maxItems, 1);
  assert.equal(request.body.text.format.schema.properties.conjugations.items.properties.forms.maxItems, 6);
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.schema.properties.meanings.items.properties.examples.maxItems, 2);
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
});
test('API failures, refusals, cutoffs and malformed content never produce a card', async () => {
  for (const status of [401, 403, 429, 500]) await assert.rejects(generateEntry('x', DEFAULTS, 'key', { fetchImpl: async () => ({ ok: false, status }) }));
  for (const response of [{ status: 'incomplete' }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, { status: 'completed', output: [] }, completed({ ...fixture, meanings: [] })]) await assert.rejects(generateEntry('x', DEFAULTS, 'key', { fetchImpl: async () => jsonResponse(response) }));
  await assert.rejects(generateEntry('x', DEFAULTS, ''), /API key/);
});
test('card content is escaped and deduplication is independent of inflected input', () => {
  const entry = structuredClone(fixture); entry.meanings[0].definition = '<img src=x onerror="alert(1)">';
  const note = buildNote(entry, { ...DEFAULTS, reverse: true });
  assert(!note.fields.Meanings.includes('<img'));
  assert(note.fields.Meanings.includes('&lt;img'));
  assert.equal(note.fields.Reverse, 'yes');
  assert(!note.fields.Definitions.includes('Hablo español'));
  assert.equal(buildNote({ ...fixture, word: 'hablamos' }, DEFAULTS).fields.Identity, buildNote(fixture, DEFAULTS).fields.Identity);
  assert.notEqual(buildNote(fixture, { ...DEFAULTS, sourceLanguage: 'French' }).fields.Identity, note.fields.Identity);
});
test('Anki integration creates note type and deck, then adds; retry skips duplicate', async () => {
  let saved = false, createdModel = false; const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    const { action } = request; let result = null;
    if (action === 'modelNames') result = createdModel ? [MODEL_NAME] : [];
    if (action === 'createModel') { createdModel = true; result = {}; }
    if (action === 'modelFieldNames') result = FIELDS;
    if (action === 'findNotes') result = saved ? [123] : [];
    if (action === 'createDeck') result = 2;
    if (action === 'addNote') { saved = true; result = 123; }
    return jsonResponse({ error: null, result });
  };
  assert.deepEqual(await addToAnki(fixture, DEFAULTS, 'anki-key', fetchImpl), { duplicate: false, noteId: 123 });
  assert.deepEqual(await addToAnki(fixture, DEFAULTS, 'anki-key', fetchImpl), { duplicate: true, noteId: 123 });
  assert.equal(calls.filter(c => c.action === 'addNote').length, 1);
  assert(calls.every(c => c.key === 'anki-key' && c.version === 6));
  const templates = calls.find(c => c.action === 'createModel').params.cardTemplates;
  assert(templates[1].Front.includes('{{#Reverse}}'));
  assert(!templates[1].Front.includes('{{Meanings}}'));
});

test('legacy settings migrate to compact cards with audio enabled, without discarding other preferences', () => {
  const migrated = validateSettings({ ...DEFAULTS, detail: 'comprehensive', sourceLanguage: 'Swedish', deck: 'My Swedish' });
  assert.equal(migrated.detail, 'compact'); assert.equal(migrated.audioEnabled, true);
  assert.equal(migrated.deck, 'My Swedish'); assert.equal(migrated.sourceLanguage, 'Swedish');
  assert.equal(validateSettings({ audioEnabled: false }).audioEnabled, false);
});

test('compact output enforces limits while legacy history remains readable', () => {
  const tooLong = structuredClone(fixture); tooLong.meanings.push(...structuredClone(fixture.meanings));
  assert.equal(validateEntry(tooLong), tooLong);
  assert.equal(validateEntry(tooLong, COMPACT_SCHEMA), tooLong);
  const tables = structuredClone(fixture); tables.conjugations.push(structuredClone(tables.conjugations[0]));
  assert.throws(() => validateEntry(tables, COMPACT_SCHEMA));
  const text = structuredClone(fixture); text.meanings[0].examples[0].sentence = 'a'.repeat(111);
  assert.throws(() => validateEntry(text, COMPACT_SCHEMA));
});

test('compact Anki markup has one highlighted form line, two examples per meaning, and no citations', () => {
  const entry = structuredClone(fixture); entry.meanings[0].definition += ' [1, 2]';
  const note = buildNote(entry, DEFAULTS);
  assert(note.fields.Forms.includes('<mark>')); assert(!note.fields.Forms.includes('<table>'));
  assert.equal((note.fields.Meanings.match(/class="translation"/g) || []).length, entry.meanings.length * 2);
  assert(!note.fields.Definitions.includes('[1, 2]'));
  assert(!note.fields.Meanings.includes('[1, 2]'));
});

test('legacy model gains audio, and explicit updates store media and preserve scheduling fields', async () => {
  const calls = []; let savedFields;
  const audio = { filename: `ankiadder-${'a'.repeat(64)}.mp3`, data: Buffer.from('ID3audio').toString('base64') };
  const fetchImpl = async (_url, options) => {
    const r = JSON.parse(options.body); calls.push(r); let result = null;
    if (r.action === 'modelNames') result = [MODEL_NAME];
    if (r.action === 'modelFieldNames') result = FIELDS.filter(f => f !== 'Audio');
    if (r.action === 'findNotes') result = [123];
    if (r.action === 'storeMediaFile') result = r.params.filename;
    if (r.action === 'updateNoteFields') savedFields = r.params.note.fields;
    if (r.action === 'notesInfo') result = [{ fields: Object.fromEntries(Object.entries(savedFields).map(([k,v]) => [k, { value: v }])) }];
    return jsonResponse({ error: null, result });
  };
  assert.deepEqual(await addToAnki(fixture, DEFAULTS, '', fetchImpl, { audio, replaceExisting: true }), { duplicate: false, updated: true, noteId: 123 });
  assert(calls.some(c => c.action === 'modelFieldAdd' && c.params.fieldName === 'Audio'));
  assert(calls.some(c => c.action === 'updateModelTemplates'));
  assert.equal(savedFields.Audio, `[sound:${audio.filename}]`);
  assert.equal(savedFields.Reverse, undefined); assert.equal(savedFields.Identity, undefined);
  assert(!calls.some(c => ['addNote', 'deleteNotes', 'changeDeck'].includes(c.action)));
  assert(calls.findIndex(c => c.action === 'storeMediaFile') < calls.findIndex(c => c.action === 'updateNoteFields'));
});

test('media upload failure prevents a note from claiming missing audio', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const r = JSON.parse(options.body); calls.push(r.action);
    const result = { modelNames: [MODEL_NAME], modelFieldNames: FIELDS, findNotes: [] }[r.action] ?? null;
    return jsonResponse({ result, error: r.action === 'storeMediaFile' ? 'disk full' : null });
  };
  await assert.rejects(addToAnki(fixture, DEFAULTS, '', fetchImpl, { audio: { filename: `ankiadder-${'b'.repeat(64)}.mp3`, data: 'SUQzYXVkaW8=' } }), /disk full/);
  assert(!calls.includes('addNote'));
});

test('silently refused Anki updates are detected', async () => {
  const fetchImpl = async (_url, options) => {
    const r = JSON.parse(options.body);
    return jsonResponse({ error: null, result: ({ modelNames: [MODEL_NAME], modelFieldNames: FIELDS, findNotes: [123], notesInfo: [{ fields: {} }] })[r.action] ?? null });
  };
  await assert.rejects(addToAnki(fixture, DEFAULTS, '', fetchImpl, { replaceExisting: true }), /Close its card editor/);
});
test('failed Anki calls and incompatible models return actionable errors', async () => {
  await assert.rejects(addToAnki(fixture, DEFAULTS, '', async () => { throw new Error('offline'); }), /Cannot reach Anki/);
  await assert.rejects(addToAnki(fixture, DEFAULTS, '', async (_url, options) => jsonResponse({ error: null, result: JSON.parse(options.body).action === 'modelNames' ? [MODEL_NAME] : [] })), /incompatible fields/);
});
test('settings and drafts survive restart without storing plaintext keys or returning them to UI', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-test-'));
  const crypto = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
  const first = new Store(directory, crypto); await first.load();
  await first.save({ ...DEFAULTS, apiKey: 'secret-123', ankiKey: 'anki-secret' });
  await first.put({ id: '1', entry: fixture, status: 'draft' });
  const second = new Store(directory, crypto); await second.load();
  assert.equal(second.secret('apiKey'), 'secret-123');
  assert.equal(second.publicSettings().apiKey, undefined);
  assert.equal(second.publicSettings().hasApiKey, true);
  assert.equal(second.history[0].entry.word, 'hablar');
  assert(!(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).includes('secret-123'));
  await second.save({ ...DEFAULTS, apiKey: '', clearAnkiKey: true });
  assert.equal(second.secret('apiKey'), 'secret-123'); assert.equal(second.secret('ankiKey'), '');
  await second.save({ ...DEFAULTS, clearApiKey: true }); assert.equal(second.secret('apiKey'), '');
});
test('unavailable key encryption and corrupt saved data fail without overwriting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-test-'));
  const store = new Store(directory, { isEncryptionAvailable: () => false }); await store.load();
  await assert.rejects(store.save({ ...DEFAULTS, apiKey: 'key' }), /Secure key storage/);
  await fs.writeFile(path.join(directory, 'settings.json'), 'broken');
  await assert.rejects(store.load(), /preserved/);
  assert.equal(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'), 'broken');
});
