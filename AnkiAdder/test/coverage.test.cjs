const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateEntry, DEFAULTS } = require('../src/core.cjs');
const fixture = require('./fixtures/halla-sig.cjs');
const settings = { ...DEFAULTS, sourceLanguage: 'Swedish' };
const previousEntry = { ...fixture, meanings: fixture.meanings.slice(0, 3) };
function mockReview(change = () => {}) {
  return async (url, options) => {
    if (url.startsWith('https://lexin.')) return { ok: true, json: async () => ({ Status: 'no matching' }) };
    const request = JSON.parse(options.body), input = JSON.parse(request.input);
    let entry = structuredClone({ ...fixture, meanings: [fixture.meanings[3]] });
    if (input.senseCandidates) {
      assert.equal(input.previousEntry.meanings.length, 3);
      assert.equal(input.senseCandidates.length, 4);
      entry = structuredClone(fixture);
      entry.senseChecks = input.senseCandidates.map(candidate => ({ id: candidate.id, status: 'covered', meaningIndexes: [candidate.id.startsWith('draft:') ? 3 : Number(candidate.id.split(':')[1])], reason: '' }));
      change(entry);
    }
    return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(entry) }] }] }) };
  };
}
test('regeneration reviews all three old meanings alongside the newly found freshness sense', async () => {
  const result = await generateEntry(fixture.word, settings, 'fake', { targetLemma: fixture.lemma, previousEntry, fetchImpl: mockReview() });
  assert.deepEqual(result.meanings.map(meaning => meaning.definition), fixture.meanings.map(meaning => meaning.definition));
  assert.equal(result.senseChecks, undefined);
});
test('missing, collapsed, out-of-range and explicitly dropped saved definitions cannot overwrite history', async () => {
  for (const change of [entry => { delete entry.senseChecks; }, entry => entry.senseChecks.pop(), entry => { entry.senseChecks[2].meaningIndexes = [0]; }, entry => { entry.meanings = [entry.meanings[3]]; }, entry => { entry.senseChecks[1] = { id: 'saved:0', status: 'unsupported', meaningIndexes: [], reason: 'Different construction' }; }]) {
    await assert.rejects(generateEntry(fixture.word, settings, 'fake', { targetLemma: fixture.lemma, previousEntry, fetchImpl: mockReview(change) }), /Language review failed/);
  }
});
test('dictionary expressions accept natural tense, reflexive changes and intervening objects', async () => {
  const { generateEntry: mockedGeneration } = require('./review-helper.cjs');
  for (const [word, lemma, sentence] of [
    ['att lägga öde', 'lägga öde', 'Kriget lade hela byn öde och familjerna tvingades fly.'],
    ['lägga öde', 'lägga öde', 'Branden har lagt området öde, så invånarna måste flytta.'],
    ['hålla sig', 'hålla sig', 'Jag håller mig hemma eftersom jag fortfarande är sjuk.'],
  ]) {
    const entry = { ...fixture, word, lemma, meanings: [{ ...fixture.meanings[0], examples: [{ sentence, translation: 'A complete translation.' }, { sentence, translation: 'A complete translation.' }] }] };
    const result = await mockedGeneration(word, settings, 'fake', { fetchImpl: async url => ({ ok: true, json: async () => url.startsWith('https://lexin.') ? { Status: 'no matching' } : { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(entry) }] }] } }) });
    assert.equal(result.meanings[0].examples[0].sentence, sentence);
  }
});
