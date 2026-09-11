const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('./fixture.cjs');
const { FIELDS } = require('../src/core.cjs');

(async () => {
  await fs.mkdir('test-output', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('test-output/batch-'));
  const env = { ...process.env, ANKIADDER_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const audioBytes = (await fs.readFile(path.join(__dirname, 'tone.mp3'))).toString('base64');
  let app;
  const errors = [];
  async function waitForBatch(page, predicate) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.ankiAdder.batch());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for batch state');
  }
  async function launch() {
    app = await electron.launch({ args: ['.', '--smoke-test'], env });
    await app.evaluate((_electron, { fixture, fields, audioBytes }) => {
      globalThis.batchCalls = []; globalThis.failures = true; globalThis.offline = false;
      globalThis.notes = new Map(); globalThis.nextNote = 100; globalThis.holdWord = '';
      globalThis.fetch = async (url, options) => {
        const request = JSON.parse(options.body); globalThis.batchCalls.push(request);
        if (String(url).includes('/audio/speech')) {
          if (globalThis.failures && request.input === 'speechfail') return { ok: false, status: 429 };
          return { ok: true, headers: { get: () => 'text/event-stream' }, text: async () => `data: ${JSON.stringify({ type: 'speech.audio.delta', audio: audioBytes })}\n\ndata: ${JSON.stringify({ type: 'speech.audio.done', usage: { input_tokens: 100, output_tokens: 75 } })}\n\n` };
        }
        if (String(url).includes('api.openai.com')) {
          const word = JSON.parse(request.input).word;
          if (word === globalThis.holdWord) await new Promise(resolve => { globalThis.releaseWord = resolve; });
          if (globalThis.failures && word === 'failtext') return { ok: false, status: 429, json: async () => ({ error: { message: 'Test quota failure' } }) };
          return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...fixture, word, lemma: word, warnings: word === 'uncertain' ? ['Uncertain meaning'] : [] }) }] }] }) };
        }
        if (globalThis.offline) throw new Error('offline');
        let result = ({ version: 6, deckNames: ['Default', 'Batch::日本語'], modelNames: ['AnkiAdder Vocabulary v1'], modelFieldNames: fields, createDeck: 1 })[request.action] ?? null;
        if (request.action === 'findNotes') { const key = request.params.query.match(/Identity:[a-f0-9]+/)[0]; result = globalThis.notes.has(key) ? [globalThis.notes.get(key)] : []; }
        if (request.action === 'storeMediaFile') result = request.params.filename;
        if (request.action === 'addNote') {
          const note = request.params.note;
          if (globalThis.failures && note.fields.Word.includes('ankifail')) return { ok: true, json: async () => ({ result: null, error: 'Test Anki write failure' }) };
          result = globalThis.nextNote++;
          globalThis.notes.set(`Identity:${note.fields.Identity}`, result);
        }
        return { ok: true, json: async () => ({ result, error: null }) };
      };
    }, { fixture, fields: FIELDS, audioBytes });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => Boolean(window.ankiAdder));
    return page;
  }
  try {
    let page = await launch();
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=apiKey]').fill('sk-batch-test');
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent === 'Saved automatically');
    await page.locator('.nav[data-page=batch]').click();
    await page.locator('#batch-deck').selectOption('Batch::日本語');
    await page.waitForFunction(() => !document.querySelector('#batch-deck').disabled);
    // Anki must be reachable before any paid request begins.
    await app.evaluate(() => { globalThis.offline = true; });
    await page.locator('#batch-words').fill('alpha'); await page.locator('#batch-start').click();
    await page.waitForFunction(() => !document.querySelector('#batch-start').disabled);
    assert.equal(await app.evaluate(() => globalThis.batchCalls.filter(c => c.model).length), 0);
    await app.evaluate(() => { globalThis.offline = false; });
    await page.locator('#batch-words').fill('alpha\nfailtext\nuncertain\nspeechfail\nankifail\nomega\nalpha\n');
    await page.locator('#batch-start').click();
    await waitForBatch(page, state => state.status === 'completed');
    await page.waitForFunction(() => document.querySelector('#batch-summary').textContent.startsWith('Finished'));
    let state = await page.evaluate(() => window.ankiAdder.batch());
    assert.deepEqual(state.items.map(item => item.status), ['added', 'failed', 'review', 'failed', 'failed', 'added']);
    assert.equal((await page.evaluate(() => window.ankiAdder.settings())).autoAdd, false, 'Batch adds independently of single-word auto-add preference');
    const history = await page.evaluate(() => window.ankiAdder.history());
    assert.equal(history.length, 5);
    assert(history.find(item => item.entry.lemma === 'alpha').audio);
    assert(await app.evaluate(() => globalThis.batchCalls.filter(c => c.action === 'addNote').every(c => c.params.note.deckName === 'Batch::日本語')));
    const beforeRetry = await app.evaluate(() => globalThis.batchCalls.filter(c => c.model && c.model !== 'gpt-4o-mini-tts').length);
    await app.evaluate(() => { globalThis.failures = false; });
    await page.locator('#batch-retry').click();
    await waitForBatch(page, state => state.status === 'completed' && state.items.every(item => item.status !== 'failed'));
    await page.waitForFunction(() => !document.querySelector('#batch-start').disabled);
    assert.equal(await app.evaluate(() => globalThis.batchCalls.filter(c => c.model && c.model !== 'gpt-4o-mini-tts').length), beforeRetry + 1, 'Only the failed text request is generated again');
    assert.equal((await page.evaluate(() => window.ankiAdder.history())).length, 6);
    await page.screenshot({ path: path.resolve('test-output/batch-complete.png'), fullPage: true });
    // An existing lemma must not add another note.
    await page.locator('#batch-words').fill('alpha'); await page.locator('#batch-start').click();
    await page.waitForFunction(() => document.querySelector('#batch-summary').textContent.includes('1/1 processed') && document.querySelector('#batch-summary').textContent.startsWith('Finished'));
    state = await page.evaluate(() => window.ankiAdder.batch());
    assert.equal(state.items[0].status, 'duplicate');
    await page.waitForFunction(() => !document.querySelector('#batch-start').disabled);
    // Navigation and renderer reload do not interrupt a running word; stop waits for it.
    await app.evaluate(() => { globalThis.holdWord = 'pauseword'; });
    await page.locator('#batch-words').fill('pauseword\nlastword'); await page.locator('#batch-start').click();
    await waitForBatch(page, state => state.items[0].word === 'pauseword' && state.items[0].status === 'processing');
    await page.locator('.nav[data-page=history]').click();
    await page.reload();
    await page.locator('.nav[data-page=batch]').click();
    await page.waitForFunction(() => document.querySelector('#batch-summary').textContent.includes('pauseword'));
    assert(await page.locator('#generate').isDisabled());
    assert.match(await page.evaluate(async () => { try { await window.ankiAdder.saveSettings(await window.ankiAdder.settings()); return ''; } catch(e) { return e.message; } }), /current operation/);
    await page.locator('#batch-stop').click();
    await app.evaluate(() => globalThis.releaseWord());
    await waitForBatch(page, state => state.status === 'paused');
    await app.close();
    page = await launch();
    await page.locator('.nav[data-page=batch]').click();
    await page.locator('#batch-resume').waitFor();
    assert.equal(await app.evaluate(() => globalThis.batchCalls.filter(c => c.model).length), 0);
    await page.locator('#batch-resume').click();
    await waitForBatch(page, state => state.status === 'completed');
    assert.equal(await app.evaluate(() => globalThis.batchCalls.filter(c => c.model && c.model !== 'gpt-4o-mini-tts').length), 1);
    assert.deepEqual(errors, []);
    console.log('Batch UI passed: automatic Anki additions, per-word failures, retry without text regeneration, duplicates, navigation/reload, stop and restart/resume.');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
