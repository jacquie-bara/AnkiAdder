const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BatchQueue, parseWords } = require('../src/batch.cjs');

function setup(processItem, preflight = async () => {}) {
  let saved, awake = false;
  const store = { read: async (_name, fallback) => saved || fallback, write: async (_name, value) => { saved = structuredClone(value); } };
  const queue = new BatchQueue({ store, processItem, preflight, keepAwake: () => { awake = true; return () => { awake = false; }; } });
  return { queue, store, isAwake: () => awake };
}
const result = (item, status = 'added') => ({ record: { id: item.id, status, entry: { warnings: [] } } });

test('batch input preserves phrases and scripts, removes blank/repeated lines, validates limits', () => {
  assert.deepEqual(parseWords(' casa \r\npor favor\n日本語\n\ncasa\rskum'), ['casa', 'por favor', '日本語', 'skum']);
  assert.deepEqual(parseWords('é\ne\u0301'), ['é']);
  for (const input of ['', null, 'x'.repeat(201), Array.from({ length: 1001 }, (_, i) => `word${i}`).join('\n')]) assert.throws(() => parseWords(input));
});

test('batch continues past failures and uncertainty, reports duplicates, and retries only failures', async () => {
  const calls = []; let retry = false;
  const { queue, isAwake } = setup(async item => {
    assert(isAwake()); calls.push(item.word);
    if (item.word === 'bad' && !retry) throw new Error('Network unavailable');
    if (item.word === 'uncertain') return { record: { id: item.id, entry: { warnings: ['Uncertain'] } }, addError: 'Review first' };
    return result(item, item.word === 'existing' ? 'duplicate' : 'added');
  });
  await queue.start('one\nbad\nuncertain\nexisting\ntwo', { deck: '日本語' }); await queue.done;
  assert.equal(queue.state.status, 'completed'); assert(!isAwake());
  assert.deepEqual(queue.state.items.map(item => item.status), ['added', 'failed', 'review', 'duplicate', 'added']);
  retry = true; await queue.resume(true); await queue.done;
  assert.deepEqual(calls, ['one', 'bad', 'uncertain', 'existing', 'two', 'bad']);
});

test('stop finishes the active word, persists remaining words and resumes original settings', async () => {
  let finish, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const seen = [];
  const { queue, store } = setup(async (item, settings) => { seen.push(settings.deck); started(); await gate; return result(item); });
  await queue.start('one\ntwo', { deck: 'Original' }); await entered;
  queue.stop(); finish(); await queue.done;
  assert.equal(queue.state.status, 'paused');
  assert.deepEqual(queue.state.items.map(item => item.status), ['added', 'pending']);
  const restored = new BatchQueue({ store, processItem: async (item, settings) => { seen.push(settings.deck); return result(item); }, preflight: async () => {} });
  await restored.load(); await restored.resume(); await restored.done;
  assert.deepEqual(seen, ['Original', 'Original']);
  assert.equal(restored.state.status, 'completed');
});

test('interrupted work loads paused and does not automatically make paid requests', async () => {
  const { queue, store } = setup(() => { throw new Error('Must not run'); });
  await store.write('batch.json', { status: 'running', settings: {}, items: [{ id: 'checkpoint', word: 'word', status: 'processing', recordId: 'saved-draft' }] });
  await queue.load();
  assert.equal(queue.state.status, 'paused'); assert(!queue.running);
  assert.equal(queue.state.items[0].status, 'pending'); assert.equal(queue.state.items[0].recordId, 'saved-draft');
});

test('preflight failure leaves the previous batch intact and releases the operation lock', async () => {
  let offline = false;
  const { queue } = setup(async item => result(item), async () => { if (offline) throw new Error('Open Anki'); });
  await queue.start('one', {}); await queue.done; const previous = queue.snapshot();
  offline = true; await assert.rejects(queue.start('two', {}), /Open Anki/);
  assert.deepEqual(queue.snapshot(), previous); assert(!queue.running);
});

test('batch rejects overlapping starts while preflight is pending', async () => {
  let ready;
  const gate = new Promise(resolve => { ready = resolve; });
  const { queue } = setup(async item => result(item), () => gate);
  const first = queue.start('one', {});
  await assert.rejects(queue.start('two', {}), /already running/);
  ready(); await first; await queue.done;
});
