const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DEFAULTS, FIELDS } = require('../src/core.cjs');
const fixture = {
  word: 'dricka ur', lemma: 'dricka ur', pronunciation: '', grammar: '', notes: '', coverage: '', warnings: [],
  meanings: [{ partOfSpeech: 'verb', definition: 'drink up; finish a drink', usage: '', examples: [
    { sentence: 'Hon drack ur sitt kaffe innan hon sprang till bussen.', translation: 'She finished her coffee before running to the bus.' },
    { sentence: 'Han drack ur sitt glas och bad om mer vatten.', translation: 'He finished his drink and asked for more water.' },
  ] }],
  conjugations: [{ title: 'Principal forms', forms: ['att dricka ur', 'dricker ur', 'drack ur', 'har druckit ur', 'urdrucken', 'drick ur'].map((form, i) => ({ label: ['infinitive', 'present', 'past', 'perfect', 'participle', 'imperative'][i], form })) }],
};

(async () => {
  await fs.mkdir('test-output', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('test-output/history-'));
  const filename = `ankiadder-${'b'.repeat(64)}.mp3`;
  const bytes = await fs.readFile(path.join(__dirname, 'tone.mp3'));
  await fs.mkdir(path.join(directory, 'audio'));
  await fs.writeFile(path.join(directory, 'audio', filename), bytes);
  const records = ['frånvarande', 'dricka ur', 'dricka'].map((lemma, i) => ({
    id: String(i), createdAt: '2026-09-12T08:00:00.000Z', sourceLanguage: 'Swedish', translationLanguage: 'English', model: DEFAULTS.model, format: 'compact', status: i === 1 ? 'added' : 'draft',
    entry: { ...structuredClone(fixture), lemma, word: i === 1 ? 'drack ur sitt kaffe' : lemma, pronunciation: '/saved pronunciation/' },
    costs: { text: { usd: 0.01 }, pronunciation: { usd: i === 1 ? 0.02 : 0, basis: i === 1 ? 'usage' : 'off' } },
    ...(i === 1 ? { noteId: 456, deck: 'Original deck', audio: { filename, voice: 'marin' } } : {}),
  }));
  await fs.writeFile(path.join(directory, 'history.json'), JSON.stringify(records));
  const env = { ...process.env, ANKIADDER_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--smoke-test'], env });
  try {
    await app.evaluate((_electron, { records, fields }) => {
      globalThis.calls = []; globalThis.savedFields = {}; globalThis.noteDecks = { 456: 'Original deck' };
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://lexin.')) return { ok: true, json: async () => ({ Status: 'no matching' }) };
        const request = JSON.parse(options.body); globalThis.calls.push(request);
        if (String(url).includes('/audio/speech')) throw new Error('Text regeneration must never request speech');
        if (String(url).includes('api.openai.com')) {
          const input = JSON.parse(request.input);
          const reviewing = request.text.format.name === 'reviewed_word_entry';
          if (reviewing && globalThis.holdReview) await new Promise((resolve, reject) => {
            globalThis.reviewWaiting = true;
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
          if (reviewing && globalThis.reviewFail) return { ok: false, status: 429 };
          const entry = structuredClone(input.draft || records.find(record => record.entry.lemma === input.targetLemma).entry);
          entry.meanings[0].definition = 'finish a drink';
          entry.meanings[0].examples[0] = { sentence: 'Hon drack ur sitt kaffe innan hon sprang till bussen.', translation: 'She finished her coffee before running to the bus.' };
          entry.pronunciation = '/new model IPA/';
          if (reviewing && globalThis.mismatch) entry.lemma = 'dricka';
          if (reviewing) entry.senseChecks = input.senseCandidates.map(candidate => ({ id: candidate.id, status: 'covered', meaningIndexes: [0], reason: '' }));
          return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 1000 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(entry) }] }] }) };
        }
        let result = ({ version: 6, deckNames: ['Original deck', 'Different deck'], modelNames: ['AnkiAdder Vocabulary v1'], modelFieldNames: fields, findNotes: Object.keys(globalThis.noteDecks).map(Number) })[request.action] ?? null;
        if (request.action === 'storeMediaFile') result = request.params.filename;
        if (request.action === 'updateNoteFields') globalThis.savedFields = request.params.note.fields;
        if (request.action === 'notesInfo') result = request.params.notes.map(id => ({ cards: [id], fields: Object.fromEntries(Object.entries(globalThis.savedFields).map(([k, v]) => [k, { value: v }])) }));
        if (request.action === 'cardsInfo') result = request.params.cards.map(id => ({ note: id, deckName: globalThis.noteDecks[id] }));
        if (request.action === 'addNote') { result = 457; globalThis.noteDecks[result] = request.params.note.deckName; }
        return { ok: true, json: async () => ({ result, error: null }) };
      };
    }, { records, fields: FIELDS });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.ankiAdder && document.querySelector('#history-count').textContent === '3');
    await page.evaluate(async () => window.ankiAdder.saveSettings({ ...await window.ankiAdder.settings(), apiKey: 'fake', sourceLanguage: 'Spanish', translationLanguage: 'German', autoAdd: true }));
    await page.reload();
    await page.locator('.nav[data-page=history]').click();
    await page.locator('[data-record="0"]').click();
    assert(await page.locator('#page-history').isVisible());
    assert(await page.locator('#history-previous').isDisabled());
    assert.equal(await page.locator('#history-position').textContent(), '1 / 3');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3');
    assert.match(await page.locator('.word-heading').textContent(), /dricka ur/);
    await page.locator('#history-next').click();
    assert.equal(await page.locator('#history-position').textContent(), '3 / 3');
    assert(await page.locator('#history-next').isDisabled());
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#history-position').textContent(), '3 / 3');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3');
    await page.locator('#edit-entry').click();
    await page.locator('[data-path="meanings.0.definition"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3');
    await page.locator('#editor-cancel').click();
    await page.locator('.word-heading').focus(); await page.keyboard.press('Alt+ArrowRight');
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3');
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => call.model).length), 0, 'Browsing and editing navigation are free');

    await page.locator('#regenerate-text').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Text regenerated'));
    let saved = (await page.evaluate(() => window.ankiAdder.history())).find(record => record.id === '1');
    assert.deepEqual(saved.audio, records[1].audio); assert.equal(saved.entry.pronunciation, records[1].entry.pronunciation);
    assert.equal(saved.entry.word, records[1].entry.word); assert.equal(saved.entry.lemma, 'dricka ur');
    assert.equal(saved.entry.meanings[0].definition, 'finish a drink'); assert(saved.pendingAnkiChanges);
    assert.equal(saved.noteId, 456); assert.equal(saved.deck, 'Original deck'); assert.equal(saved.createdAt, records[1].createdAt);
    assert.equal(saved.costs.text.receipts.length, 3); assert(Math.abs(saved.costs.text.usd - 0.0128) < 1e-10);
    assert.deepEqual(saved.costs.pronunciation, records[1].costs.pronunciation);
    assert.equal((await page.evaluate(() => window.ankiAdder.history())).length, 3);
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3', 'Saving does not reorder the active browse session');
    const calls = await app.evaluate(() => globalThis.calls.filter(call => call.model));
    assert.equal(calls.length, 2);
    assert(calls.every(call => /Swedish/.test(call.instructions) && /English/.test(call.instructions)));
    assert(calls.every(call => JSON.parse(call.input).targetLemma === 'dricka ur'));
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => ['addNote', 'updateNoteFields', 'storeMediaFile'].includes(call.action)).length), 0, 'Regeneration does not automatically write to Anki');
    const audio = await page.evaluate(() => window.ankiAdder.audio('1'));
    assert.equal(audio.src, `data:audio/mpeg;base64,${bytes.toString('base64')}`);
    await page.locator('#history-next').click(); await page.locator('#history-previous').click();
    assert.equal(await page.locator('#history-position').textContent(), '2 / 3');

    for (const [flag, message] of [['reviewFail', 'Language review failed'], ['mismatch', 'changed the word'], ['holdReview', 'cancelled']]) {
      console.log('Checking regeneration failure:', flag);
      const before = await page.evaluate(() => window.ankiAdder.history());
      await app.evaluate((_electron, flag) => { globalThis[flag] = true; globalThis.reviewWaiting = false; }, flag);
      await page.locator('#regenerate-text').click();
      if (flag === 'holdReview') {
        await page.waitForFunction(() => !document.querySelector('#cancel-text').hidden);
        assert(await page.locator('#history-next').isDisabled());
        assert.match(await page.evaluate(async () => { try { await window.ankiAdder.regenerateText('1'); return ''; } catch (error) { return error.message; } }), /already in progress/);
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#history-position').textContent(), '2 / 3');
        await page.locator('#cancel-text').click();
      }
      try { await page.waitForFunction(message => document.querySelector('#notice').textContent.includes(message) && !document.querySelector('#regenerate-text').disabled, message); }
      catch (error) { console.log('Notice:', await page.locator('#notice').textContent()); throw error; }
      assert.deepEqual(await page.evaluate(() => window.ankiAdder.history()), before);
      await app.evaluate((_electron, flag) => { globalThis[flag] = false; }, flag);
    }
    await page.locator('#update-note').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Updated in Anki'));
    assert.equal(await app.evaluate(() => globalThis.savedFields.Audio), `[sound:${filename}]`);
    assert.match(await app.evaluate(() => globalThis.savedFields.Meanings), /finish a drink/);
    await page.locator('#history-back').click();
    await page.locator('#history-search').fill('drick');
    await page.keyboard.press('ArrowRight');
    assert(await page.locator('#history-browser').isVisible(), 'Search editing does not open a word');
    await page.locator('[data-record="1"]').click();
    assert.equal(await page.locator('#history-position').textContent(), '1 / 2');
    await page.locator('#history-next').click();
    assert.equal(await page.locator('#history-position').textContent(), '2 / 2');
    await page.locator('#history-back').click();
    assert.equal(await page.locator('#history-search').inputValue(), 'drick');
    await page.reload(); await page.locator('.nav[data-page=history]').click(); await page.locator('[data-record="1"]').click();
    saved = (await page.evaluate(() => window.ankiAdder.history())).find(record => record.id === '1');
    assert.deepEqual(saved.audio, records[1].audio); assert.equal(saved.entry.meanings[0].definition, 'finish a drink');
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(directory, 'audio', filename))).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    await page.screenshot({ path: path.resolve('test-output/history-navigation.png'), fullPage: true });
    await page.setViewportSize({ width: 760, height: 850 });
    assert(await page.locator('#history-navigation').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    assert(await page.locator('#regenerate-text').isVisible());
    await page.waitForFunction(() => document.querySelector('#entry-membership').textContent.includes('Original deck'));
    await page.locator('#preview-deck').selectOption('Different deck');
    await page.locator('#add-note').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Added to the selected'));
    await page.waitForFunction(() => document.querySelector('#entry-membership').textContent.includes('Different deck'));
    assert.equal(await app.evaluate(() => globalThis.noteDecks[456]), 'Original deck');
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => call.action === 'addNote').length), 1);
    await page.locator('#add-note').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('already in the selected deck'));
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => call.action === 'addNote').length), 1);
    const paidBeforeUndo = await app.evaluate(() => globalThis.calls.filter(call => call.model).length);
    const costsBeforeUndo = (await page.evaluate(() => window.ankiAdder.history())).find(record => record.id === '1').costs;
    await page.locator('[data-restore=text]').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Previous version restored'));
    const restored = (await page.evaluate(() => window.ankiAdder.history())).find(record => record.id === '1');
    assert.deepEqual(restored.entry, records[1].entry); assert.deepEqual(restored.costs, costsBeforeUndo); assert(restored.pendingAnkiChanges);
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => call.model).length), paidBeforeUndo);
    await page.locator('#history-back').click();
    await page.evaluate(() => { window.confirm = () => false; });
    await page.locator('[data-delete="0"]').click();
    assert.equal((await page.evaluate(() => window.ankiAdder.history())).length, 3);
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('[data-delete="0"]').click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '2');
    await page.locator('[data-record="1"]').click();
    await page.locator('#preview [data-delete="1"]').click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    assert.equal(await page.locator('#history-position').textContent(), '1 / 1');
    assert.match(await page.locator('.word-heading').textContent(), /^dricka \(verb\)$/);
    await page.locator('#preview [data-delete="2"]').click();
    await page.waitForFunction(() => !document.querySelector('#history-browser').hidden);
    await page.reload();
    assert.equal((await page.evaluate(() => window.ankiAdder.history())).length, 0);
    assert.equal(await app.evaluate(() => globalThis.calls.filter(call => call.action === 'deleteNotes').length), 0);
    console.log('History UI passed: buttons/keyboard/filtering, stable order, text-only regeneration, original languages/audio/identity, costs, cancellation/failures, explicit Anki update and reload.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
