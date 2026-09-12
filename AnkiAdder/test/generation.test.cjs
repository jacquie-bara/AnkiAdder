const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupSwedish, dictionaryEntries } = require('../src/lexin.cjs');
const { validateEntry, COMPACT_SCHEMA, DEFAULTS } = require('../src/core.cjs');
const { generateEntry } = require('./review-helper.cjs');
// Recorded from Lexin's public Swedish service on 2026-09-12.
const lexin = require('./fixtures/lexin-urdrucken.json');
const fixture = require('./fixture.cjs');
const settings = { ...DEFAULTS, sourceLanguage: 'Swedish' };
const response = value => ({ ok: true, json: async () => value });
const completed = entry => response({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(entry) }] }] });
function entryWith(sentence, lemma = 'dricka ur') {
  const entry = structuredClone(fixture);
  entry.word = 'urdrucken'; entry.lemma = lemma;
  entry.meanings = [{ partOfSpeech: 'verb', definition: 'drink up; finish a drink', usage: '', examples: [
    { sentence, translation: 'The bottle was empty, so she opened a new one for the guests.' },
    { sentence: 'Han drack ur sitt kaffe innan han sprang till bussen.', translation: 'He finished his coffee before running to the bus.' },
  ] }];
  return entry;
}

test('Lexin resolves urdrucken through the particle verb and its participle', async () => {
  let request;
  const result = await lookupSwedish('urdrucken', 'Svenska', { fetchImpl: async (url, options) => { request = { url: new URL(url), options }; return response(lexin); } });
  assert.equal(request.url.searchParams.get('searchinfo'), 'both,swe_swe,urdrucken');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result.entries[0].headword, 'dricker ur');
  assert(result.entries[0].forms.some(form => form.form === 'dricka ur'));
  assert(result.entries[0].forms.some(form => form.form === 'urdrucken' && form.label === 'perf.part.'));
  assert.match(result.entries[0].meanings[0].definition, /hela mängden/);
});

test('Lexin suggestions and unrelated results are not treated as exact evidence', () => {
  assert.deepEqual(dictionaryEntries({ ...lexin, Status: 'no unique matching' }, 'urdrucken'), []);
  assert.deepEqual(dictionaryEntries(lexin, 'urdruckenn'), []);
  assert.deepEqual(dictionaryEntries(null, 'urdrucken'), []);
  assert.equal(dictionaryEntries(lexin, 'har druckit ur').length, 1);
  assert.equal(dictionaryEntries({ Status: 'found', Result: [{ Value: 'från|varande', Type: 'adj.' }] }, 'FRÅNVARANDE').length, 1);
});
test('Lexin retains nested adjective constructions and idiom definitions for hålla sig', () => {
  const [entry] = dictionaryEntries(require('./fixtures/lexin-halla-sig.json'), 'hålla sig');
  assert.equal(entry.meanings.length, 1);
  assert.match(entry.meanings[0].constructions[0].grammar[0], /ADJ/);
  assert(entry.meanings[0].expressions.some(item => item.expression === 'håller sig i skinnet' && item.definition === 'uppträder lugnt'));
});

test('dictionary lookup is optional, bounded, and cancellation does not become an offline fallback', async () => {
  const unused = async () => { assert.fail('Unexpected dictionary request'); };
  assert.equal(await lookupSwedish('hablar', 'Spanish', { fetchImpl: unused }), null);
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => ({ ok: false }), async () => response({ Status: 'no matching' }), async () => ({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } })]) {
    assert.equal(await lookupSwedish('urdrucken', 'Swedish', { fetchImpl }), null);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lookupSwedish('urdrucken', 'Swedish', { signal: controller.signal, fetchImpl: unused }), { name: 'AbortError' });
  const during = new AbortController();
  await assert.rejects(generateEntry('urdrucken', settings, 'fake', { signal: during.signal, fetchImpl: async () => { during.abort(); throw during.signal.reason; } }), { name: 'AbortError' });
});

test('generation and separate review receive dictionary evidence and preserve the supplied participle', async () => {
  const calls = [];
  const expected = entryWith('Flaskan var urdrucken, så hon öppnade en ny åt gästerna.');
  const entry = await generateEntry('urdrucken', settings, 'fake', { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.startsWith('https://lexin.') ? response(lexin) : completed(expected);
  } });
  assert.equal(calls.length, 3);
  const review = JSON.parse(calls[2].options.body);
  assert.equal(review.text.format.name, 'reviewed_word_entry');
  assert.deepEqual(JSON.parse(review.input).draft, expected);
  assert.deepEqual(JSON.parse(review.input).dictionary, JSON.parse(JSON.parse(calls[1].options.body).input).dictionary);
  const request = JSON.parse(calls[1].options.body);
  const input = JSON.parse(request.input);
  assert.equal(input.word, 'urdrucken');
  assert.equal(input.dictionary.entries[0].headword, 'dricker ur');
  assert.equal(entry.lemma, 'dricka ur');
  assert.equal(entry.word, 'urdrucken');
  assert.match(entry.meanings[0].examples[0].sentence, /urdrucken/);
  assert.match(request.instructions, /main meaningful verb/);
  assert.match(request.instructions, /reason, consequence, contrast/);
  assert.match(request.instructions, /not be unrelated filler/);
  assert.match(request.instructions, /rewrite weak examples/);
  assert.doesNotMatch(request.instructions, /4–8 words|35–45 words/);
});

test('dictionary failure still permits model generation without invented dictionary evidence', async () => {
  let request;
  await generateEntry('urdrucken', settings, 'fake', { fetchImpl: async (url, options) => {
    if (url.startsWith('https://lexin.')) throw new Error('offline');
    request = JSON.parse(options.body);
    return completed(entryWith('Flaskan var urdrucken, så hon öppnade en ny åt gästerna.'));
  } });
  assert.equal(JSON.parse(request.input).dictionary, undefined);
});

test('whole phrase survives normalization to the important verb, including tense and word order', async () => {
  const entry = await generateEntry('drack ur sitt kaffe', settings, 'fake', { fetchImpl: async url => url.startsWith('https://lexin.') ? response({ Status: 'no matching' }) : completed(entryWith('Hon drack ur sitt kaffe innan hon sprang till bussen.')) });
  assert.equal(entry.lemma, 'dricka ur');
  assert.equal(entry.word, 'drack ur sitt kaffe');
});

test('a long phrase with no exact match gets lemma evidence for review', async () => {
  const lookups = [];
  let reviewInput;
  await generateEntry('drack ur sitt kaffe', settings, 'fake', { fetchImpl: async (url, options) => {
    if (url.startsWith('https://lexin.')) {
      const query = new URL(url).searchParams.get('searchinfo'); lookups.push(query);
      return response(query.endsWith(',dricka ur') ? lexin : { Status: 'no matching' });
    }
    const request = JSON.parse(options.body);
    if (request.text.format.name === 'reviewed_word_entry') reviewInput = JSON.parse(request.input);
    return completed(entryWith('Hon drack ur sitt kaffe innan hon sprang till bussen.'));
  } });
  assert.deepEqual(lookups, ['both,swe_swe,drack ur sitt kaffe', 'both,swe_swe,dricka ur']);
  assert.equal(reviewInput.dictionary.entries[0].headword, 'dricker ur');
});

test('changed conjugations, incomplete phrases and word substrings fail before saving a card', async () => {
  for (const [input, sentence] of [
    ['drack ur sitt te', 'Hon dricker ur sitt te innan hon springer till bussen.'],
    ['drack ur sitt te', 'Hon drack ur innan hon sprang till bussen.'],
    ['drack ur sitt te', 'Hon drack ur sitt termoskaffe innan hon sprang till bussen.'],
    ['urdrucken', 'Flaskan var urdrucket, så hon öppnade en ny åt gästerna.'],
  ]) {
    await assert.rejects(generateEntry(input, settings, 'fake', { fetchImpl: async url => url.startsWith('https://lexin.') ? response({ Status: 'no matching' }) : completed(entryWith(sentence)) }), /did not preserve your input/);
  }
});

test('long full sentences retain their wording with added context; capitalization and spacing may change', async () => {
  const input = 'Hon var frånvarande från den viktiga lektionen om Sveriges historia och kunde därför inte delta i gruppens redovisning.';
  const sentence = `${input.slice(0, -1)} eftersom hennes katt behövde akut vård.`;
  const generated = entryWith(sentence, 'vara');
  generated.meanings[0].examples[0].translation = 'She missed the important lesson on Swedish history and could not take part in the group presentation because her cat needed urgent care.';
  assert(sentence.length > 110);
  assert.equal(validateEntry(generated, COMPACT_SCHEMA), generated);
  const result = await generateEntry(input.toLowerCase().replaceAll(' ', '  ').trim(), settings, 'fake', { fetchImpl: async url => url.startsWith('https://lexin.') ? response({ Status: 'no matching' }) : completed(generated) });
  assert.equal(result.meanings[0].examples[0].sentence, sentence);
});

test('non-verbal phrases preserve the whole expression too', async () => {
  const input = 'på väg hem';
  const result = await generateEntry(input, settings, 'fake', { fetchImpl: async url => url.startsWith('https://lexin.') ? response({ Status: 'no matching' }) : completed(entryWith('På väg hem hittade hon en plånbok och lämnade den till polisen.', 'på väg')) });
  assert.equal(result.word, input);
});

test('Japanese inflected input can appear naturally beside other characters', async () => {
  const generated = entryWith('駅で買ったお弁当を食べたので、もうお腹はすいていません。', '食べる');
  const result = await generateEntry('食べた', { ...DEFAULTS, sourceLanguage: 'Japanese' }, 'fake', { fetchImpl: async () => completed(generated) });
  assert.equal(result.word, '食べた');
});

test('the screenshot regression is corrected by review before the entry can be returned', async () => {
  const draft = entryWith('Hon urdrucken sitt glas innan hon gick hem.');
  draft.meanings[0].examples[0].translation = 'She drank all of her glass before she went home.';
  draft.meanings[0].examples[1] = { sentence: 'Barnet drack ur flaskan eftersom det var törstigt efter leken.', translation: 'The child drank the bottle empty because it was thirsty after playing.' };
  const corrected = entryWith('Flaskan var urdrucken, så hon öppnade en ny åt gästerna.');
  const receipts = [];
  const result = await generateEntry('urdrucken', settings, 'fake', { onUsage: usage => receipts.push(usage), fetchImpl: async (url, options) => {
    if (url.startsWith('https://lexin.')) return response(lexin);
    const request = JSON.parse(options.body);
    const reviewing = request.text.format.name === 'reviewed_word_entry';
    if (reviewing) assert.deepEqual(JSON.parse(request.input).draft, draft);
    const output = await completed(reviewing ? corrected : draft).json();
    return response({ ...output, usage: { input_tokens: reviewing ? 2000 : 1000, output_tokens: 500 } });
  } });
  assert.deepEqual(result, corrected);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].input_tokens, 2000);
});

test('failed, malformed, refused or incomplete review never returns the unreviewed draft', async () => {
  for (const failure of [
    { ok: false, status: 429 }, response({ status: 'incomplete' }),
    response({ status: 'completed', output: [] }),
    response({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }),
    completed({ ...fixture, meanings: [] }),
  ]) {
    let requests = 0;
    await assert.rejects(generateEntry('hablar', DEFAULTS, 'fake', { fetchImpl: async () => ++requests === 1 ? completed(fixture) : failure }), /Language review failed/);
    assert.equal(requests, 2);
  }
});

test('review warnings survive and cancellation between generation and review makes no second request', async () => {
  const draft = { ...fixture, warnings: ['Original uncertainty'] };
  let requests = 0;
  const result = await generateEntry('hablar', DEFAULTS, 'fake', { fetchImpl: async () => completed(++requests === 1 ? draft : { ...fixture, warnings: ['Review uncertainty'] }) });
  assert.deepEqual(result.warnings, ['Original uncertainty', 'Review uncertainty']);
  const controller = new AbortController(); requests = 0;
  await assert.rejects(generateEntry('hablar', DEFAULTS, 'fake', { signal: controller.signal, onUsage: () => controller.abort(), fetchImpl: async () => { requests++; return completed(fixture); } }), { name: 'AbortError' });
  assert.equal(requests, 1);
});
