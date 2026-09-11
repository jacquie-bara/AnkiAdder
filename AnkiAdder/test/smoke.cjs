const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./swedish.cjs');
const { FIELDS, buildNote, DEFAULTS, CARD_TEMPLATES, CARD_CSS } = require('../src/core.cjs');

(async () => {
  const output = path.resolve('test-output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'profile-'));
  const env = { ...process.env, ANKIADDER_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  // A short tone, generated locally with FFmpeg, tests real MP3 decoding (muted).
  const audioBytes = (await fs.readFile(path.join(__dirname, 'tone.mp3'))).toString('base64');
  const app = await electron.launch({ args: ['.', '--smoke-test'], env });
  const errors = [];
  try {
    await app.evaluate((_electron, { fixture, fields, audioBytes }) => {
      globalThis.testCalls = []; globalThis.testSaved = false; globalThis.testOffline = false; globalThis.testSpeechFail = false; globalThis.testFields = {};
      globalThis.fetch = async (url, options) => {
        const request = JSON.parse(options.body); globalThis.testCalls.push(request);
        if (String(url).includes('/audio/speech')) return globalThis.testSpeechFail ? { ok: false, status: 429 } : { ok: true, headers: { get: () => 'text/event-stream' }, text: async () => `data: ${JSON.stringify({ type: 'speech.audio.delta', audio: audioBytes })}\n\ndata: ${JSON.stringify({ type: 'speech.audio.done', usage: { input_tokens: 100, output_tokens: 75 } })}\n\n` };
        if (String(url).includes('api.openai.com')) return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 1000, input_tokens_details: { cached_tokens: 500 } }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(fixture) }] }] }) };
        if (globalThis.testOffline) throw new Error('offline');
        let result = ({ version: 6, deckNames: ['Default', 'Swedish', 'Swedish::Verbs', '日本語', 'Empty deck', '日本語::漢字'], modelNames: ['AnkiAdder Vocabulary v1'], modelFieldNames: fields, findNotes: globalThis.testSaved ? [456] : [], createDeck: 1, addNote: 456 })[request.action] ?? null;
        if (request.action === 'storeMediaFile') result = request.params.filename;
        if (request.action === 'addNote') { globalThis.testSaved = true; globalThis.testFields = request.params.note.fields; }
        if (request.action === 'updateNoteFields') Object.assign(globalThis.testFields, request.params.note.fields);
        if (request.action === 'notesInfo') result = [{ fields: Object.fromEntries(Object.entries(globalThis.testFields).map(([k,v]) => [k, { value: v }])) }];
        return { ok: true, json: async () => ({ result, error: null }) };
      };
    }, { fixture, fields: FIELDS, audioBytes });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => { errors.push(e.message); console.error('Renderer error:',e.message); });
    await page.waitForFunction(() => Boolean(window.AnkiAudio));
    const silence = (await fs.readFile(path.join(__dirname, 'silence.mp3'))).toString('base64');
    assert.match(await page.evaluate(async bytes => {
      try { await window.AnkiAudio.checkRecording(`data:audio/mpeg;base64,${bytes}`); return ''; }
      catch (error) { return error.message; }
    }, silence), /recording is silent/);
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=apiKey]').fill('sk-ui-test-secret');
    assert.equal(await page.locator('[name=model]').inputValue(), 'gpt-5.6-luna');
    assert.equal(await page.locator('[name=audioEnabled]').isChecked(), true);
    await page.locator('[name=sourceLanguage]').fill('Swedish');
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent === 'Saved automatically');
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    await page.locator('.nav[data-page=create]').click();
    await page.locator('#refresh-decks').click();
    await page.waitForFunction(() => document.querySelector('#deck-help').textContent.startsWith('6 decks'));
    assert.equal(await page.locator('#deck-select option').count(), 7); // Six Anki decks plus saved destination.
    await page.locator('#deck-select').selectOption('Swedish::Verbs');
    await page.waitForFunction(() => !document.querySelector('#deck-select').disabled);
    assert.equal((await page.evaluate(() => window.ankiAdder.settings())).deck, 'Swedish::Verbs');
    await page.locator('#word').fill(fixture.lemma); await page.locator('#word').press('Enter');
    await page.locator('.word-heading').waitFor();
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    assert.equal(await page.locator('.example-list li').count(), 6);
    assert.equal(await page.locator('.key-forms span').count(), 6);
    assert.equal(await page.locator('.vocab-card table').count(), 0);
    assert((await page.locator('#cost-summary').textContent()).includes('Text $0.00131'));
    assert((await page.locator('#cost-summary').textContent()).includes('Pronunciation $0.00096'));
    await page.locator('#word').blur();
    await page.screenshot({ path: path.join(output, 'compact-preview.png'), fullPage: true });
    const size = await page.locator('.preview-sheet').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, height: el.getBoundingClientRect().height, viewport: innerHeight }));
    console.log('Preview dimensions:', size);
    assert(size.bottom <= size.viewport, 'Three-meaning preview must fit within the desktop window');
    // Decode and play the cached MP3 through the actual renderer audio path, muted.
    await page.evaluate(() => { const NativeAudio = window.Audio; window.Audio = function(src) { const audio = new NativeAudio(src); audio.muted = true; window.testAudio = audio; return audio; }; });
    await page.locator('#play-audio').click();
    console.log('Checking audio playback');
    await page.waitForFunction(() => window.testAudio?.readyState >= 2);
    await page.waitForFunction(() => !document.querySelector('#play-audio').disabled);
    await page.locator('#play-audio').click();
    await page.waitForFunction(() => !document.querySelector('#play-audio').disabled);
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-4o-mini-tts').length), 1);
    await page.locator('#add-note').click();
    console.log('Checking note addition');
    await page.getByText('Added to Anki. Your next word is waiting.').waitFor();
    assert.match(await app.evaluate(() => globalThis.testFields.Audio), /^\[sound:ankiadder-.+\.mp3\]$/);
    await page.locator('#add-note').click();
    await page.locator('#update-note').waitFor();
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.action === 'addNote').length), 1);
    await page.locator('#update-note').click();
    await page.getByText('Updated in Anki. Your review history is preserved.').waitFor();
    await page.locator('.nav[data-page=history]').click(); await page.locator('.history-row').waitFor();
    assert.equal(await page.locator('.history-row').count(), 1);
    await page.locator('.history-row').first().click();
    console.log('Checking history editing');
    const paidCalls = await app.evaluate(() => globalThis.testCalls.filter(c => c.model).length);
    const originalCost = await page.locator('#cost-summary').textContent();
    await page.locator('#edit-entry').click();
    await page.locator('[data-path="meanings.0.definition"]').fill('perform for an audience');
    await page.locator('[data-path="meanings.0.examples.0.sentence"]').fill('Hon framträder i kväll.');
    await page.screenshot({ path: path.join(output, 'card-editor.png') });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#entry-editor').open);
    assert((await page.locator('.sense-list').textContent()).includes('perform for an audience'));
    assert.equal(await page.locator('.sense-list').evaluate(el => el.tagName), 'OL');
    assert.equal(await page.locator('#cost-summary').textContent(), originalCost);
    await page.reload();
    await page.locator('.nav[data-page=history]').click();
    await page.locator('.history-row').first().click();
    assert((await page.locator('.sense-list').textContent()).includes('perform for an audience'));
    await page.locator('#edit-entry').click();
    await page.locator('#editor-update').click();
    await page.waitForFunction(() => !document.querySelector('#entry-editor').open);
    assert((await app.evaluate(() => globalThis.testFields.Meanings)).includes('Hon framträder i kväll.'));
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model).length), paidCalls);
    assert.equal(await app.evaluate(() => globalThis.testCalls.find(c => c.action === 'addNote').params.note.deckName), 'Swedish::Verbs');
    // Audio failure preserves the text and prevents automatic addition.
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=autoAdd]').check(); await page.locator('[name=voice]').selectOption('cedar');
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent === 'Saved automatically');
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    await app.evaluate(() => { globalThis.testSpeechFail = true; });
    await page.locator('.nav[data-page=create]').click();
    await page.locator('#word').fill(fixture.lemma); await page.locator('#word').press('Enter');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('speech quota'));
    let history = await page.evaluate(() => window.ankiAdder.history());
    assert.equal(history[0].status, 'draft'); assert.equal(history[0].audio, undefined);
    const generations = await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-5.6-luna').length);
    await app.evaluate(() => { globalThis.testSpeechFail = false; });
    await page.locator('#play-audio').click();
    await page.waitForFunction(() => !document.querySelector('#play-audio').disabled && document.querySelector('#play-audio').textContent.includes('Play'));
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-5.6-luna').length), generations);
    await app.evaluate(() => { globalThis.testOffline = true; });
    await page.locator('#word').fill(fixture.lemma); await page.locator('#word').press('Enter');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Your entry is saved below.'));
    history = await page.evaluate(() => window.ankiAdder.history());
    assert.equal(history[0].status, 'draft'); assert.equal(history.length, 3);
    await page.reload(); await page.locator('.nav[data-page=history]').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 3);
    await page.locator('.history-row').first().click(); await page.locator('.word-heading').waitFor();
    const restoredAudio = await page.evaluate(id => window.ankiAdder.audio(id), history[0].id);
    assert(restoredAudio.src.startsWith('data:audio/mpeg;base64,'));
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert(!(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).includes('sk-ui-test-secret'));
    assert.deepEqual(errors, []);
    // Playback preserves the original receipt; cached reuse for a new word entry is $0.
    const original = (await page.evaluate(() => window.ankiAdder.history())).find(r => r.id === history[history.length - 1].id);
    assert.equal(original.costs.pronunciation.usd, 0.00096);
    assert.equal(history[0].costs.pronunciation.usd, 0);
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=showCosts]').uncheck();
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    await page.locator('.nav[data-page=create]').click();
    await page.waitForFunction(() => document.querySelector('#cost-summary').hidden);
    await page.locator('#quick-audio').uncheck();
    await page.waitForFunction(() => !document.querySelector('#quick-audio').disabled);
    assert.equal((await page.evaluate(() => window.ankiAdder.settings())).audioEnabled, false);
    const speechCalls = await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-4o-mini-tts').length);
    await page.locator('#word').fill(fixture.lemma); await page.locator('#word').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    const offRecord = (await page.evaluate(() => window.ankiAdder.history()))[0];
    assert.equal(offRecord.audio, undefined); assert.equal(offRecord.costs.pronunciation.usd, 0);
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-4o-mini-tts').length), speechCalls);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#quick-audio').checked === false);
    assert.equal(await page.locator('#cost-summary').isVisible(), false);
    // Replace a saved recording without regenerating text, then persist and upload it.
    await page.locator('#quick-audio').check();
    await page.waitForFunction(() => !document.querySelector('#quick-audio').disabled);
    await page.locator('.nav[data-page=history]').click();
    await page.locator(`[data-record="${original.id}"]`).click();
    const beforeRepair = (await page.evaluate(() => window.ankiAdder.history())).find(r => r.id === original.id);
    const textRequests = await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-5.6-luna').length);
    await app.evaluate(() => { globalThis.testOffline = false; globalThis.testSpeechFail = true; });
    await page.locator('#regenerate-audio').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('speech quota'));
    assert.deepEqual((await page.evaluate(() => window.ankiAdder.history())).find(r => r.id === original.id).audio, beforeRepair.audio);
    await app.evaluate(() => { globalThis.testSpeechFail = false; });
    await page.locator('#regenerate-audio').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Pronunciation regenerated'));
    const repaired = (await page.evaluate(() => window.ankiAdder.history())).find(r => r.id === original.id);
    assert.notEqual(repaired.audio.filename, beforeRepair.audio.filename);
    assert.equal(repaired.costs.pronunciation.usd, beforeRepair.costs.pronunciation.usd + 0.00096);
    assert(repaired.pendingAnkiChanges);
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-5.6-luna').length), textRequests);
    const repairSpeechCalls = await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-4o-mini-tts').length);
    await page.reload();
    await page.locator('.nav[data-page=history]').click();
    await page.locator(`[data-record="${original.id}"]`).click();
    const replay = await page.evaluate(id => window.ankiAdder.audio(id), original.id);
    assert.equal(replay.record.audio.filename, repaired.audio.filename);
    assert.equal(replay.record.costs.pronunciation.usd, repaired.costs.pronunciation.usd);
    assert.equal(await app.evaluate(() => globalThis.testCalls.filter(c => c.model === 'gpt-4o-mini-tts').length), repairSpeechCalls);
    await page.locator('#update-note').click();
    await page.getByText('Updated in Anki. Your review history is preserved.').waitFor();
    assert.equal(await app.evaluate(() => globalThis.testFields.Audio), `[sound:${repaired.audio.filename}]`);
    // Render the actual Anki back template with the same fields/styles at 1000×760.
    const note = buildNote(fixture, { ...DEFAULTS, sourceLanguage: 'Swedish' });
    let back = CARD_TEMPLATES[0].Back.replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_match, key, content) => note.fields[key] ? content : '');
    back = back.replace(/{{(\w+)}}/g, (_match, key) => note.fields[key] || '');
    const previewWindow = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => { const preview = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true } }); preview.loadURL('about:blank'); });
    const browserPage = await previewWindow; await browserPage.setViewportSize({ width: 1000, height: 760 });
    await browserPage.setContent(`<html><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body class="card">${back}</body></html>`);
    assert(await browserPage.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'Actual Anki card must fit one desktop screen');
    for (const night of [false, true]) {
      assert.deepEqual(await browserPage.evaluate(night => {
        document.body.classList.toggle('nightMode', night);
        document.documentElement.style.background = night ? '#303030' : '#e4e8ee';
        return [document.body, document.querySelector('.vocab-card')].map(el => getComputedStyle(el).backgroundColor);
      }, night), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    }
    await browserPage.evaluate(() => { document.body.classList.remove('nightMode'); document.documentElement.style.background = '#e4e8ee'; });
    await browserPage.screenshot({ path: path.join(output, 'anki-compact-card.png') }); await browserPage.close();
    console.log('Desktop smoke passed: compact screen fit, full deck picker, autosave, history edits, free Anki updates, real MP3 playback, cached audio, speech failure recovery, offline drafts, reload.');
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
