const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AudioCache, parseSpeechEvents } = require('../src/audio.cjs');

test('pronunciation sends only the lemma, caches MP3 across restarts, and playback needs no key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-audio-'));
  const calls = [], bytes = Buffer.from('ID3fake-audio-for-unit-test');
  const fetchImpl = async (url, options) => { calls.push({ url, ...options }); return { ok: true, arrayBuffer: async () => bytes }; };
  const cache = new AudioCache(dir, fetchImpl);
  const first = await cache.ensure('framträda', 'Swedish', 'marin', 'fake-key');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.input, 'framträda'); assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.voice, 'marin');
  assert(body.instructions.includes('Swedish')); assert.equal(body.response_format, 'mp3');
  const restarted = new AudioCache(dir, fetchImpl);
  const second = await restarted.ensure('framträda', 'Swedish', 'marin', () => { throw new Error('Key must not be accessed'); });
  assert.equal(first.filename, second.filename); assert.equal(second.cost.usd, 0); assert.equal(second.cost.basis, 'cached'); assert.equal(calls.length, 1);
  assert.equal((await restarted.read(first.filename)).data, bytes.toString('base64'));
  await restarted.ensure('framträda', 'Swedish', 'cedar', 'fake-key'); assert.equal(calls.length, 2);
  await restarted.ensure('framträda', 'English', 'cedar', 'fake-key'); assert.equal(calls.length, 3);
});

test('speech events combine audio chunks and preserve usage for cost calculation', () => {
  const stream = [
    { type: 'speech.audio.delta', audio: Buffer.from('ID3').toString('base64') },
    { type: 'speech.audio.delta', audio: Buffer.from('some audio').toString('base64') },
    { type: 'speech.audio.done', usage: { input_tokens: 100, output_tokens: 75 } },
  ].map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const result = parseSpeechEvents(stream);
  assert.equal(result.bytes.toString(), 'ID3some audio'); assert.equal(result.cost.usd, 0.00096);
  assert.throws(() => parseSpeechEvents(stream.split('event: speech.audio.done')[0]), /interrupted/);
  assert.throws(() => parseSpeechEvents('data: {"type":"speech.audio.error"}\n\n'), /failed/);
});

test('audio rejects bad bytes, failed requests, cancellation and path traversal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ankiadder-audio-'));
  const invalid = new AudioCache(dir, async () => ({ ok: true, arrayBuffer: async () => Buffer.from('not an mp3') }));
  await assert.rejects(invalid.ensure('x', 'English', 'marin', 'key'), /invalid pronunciation/);
  await assert.rejects(invalid.read('../../settings.json'), /Invalid pronunciation filename/);
  const failed = new AudioCache(dir, async () => ({ ok: false, status: 429 }));
  await assert.rejects(failed.ensure('x', 'English', 'marin', 'key'), /quota/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(failed.ensure('x', 'English', 'marin', 'key', controller.signal), { name: 'AbortError' });
  await assert.rejects(failed.ensure('x', 'English', 'marin', ''), /API key/);
  await assert.rejects(fs.stat(path.join(dir, 'audio')), { code: 'ENOENT' });
});
