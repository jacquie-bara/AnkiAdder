const ENDPOINT = 'https://lexin.nada.kth.se/lexin/service';
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.slice(0, 600) : '';
const normalize = value => text(value).normalize('NFC').toLowerCase().replace(/\|/g, '').replace(/[.!?]+$/u, '').trim().replace(/\s+/gu, ' ');

// Lexin also returns spelling suggestions and related entries. Only ground the
// card in a headword or inflection that actually matches the submitted input.
function dictionaryEntries(data, word) {
  if (data?.Status !== 'found') return [];
  const target = normalize(word);
  return list(data.Result).filter(entry => entry && [entry.Value, ...list(entry.Inflection).flatMap(form => [form?.Content, `${text(form?.Spec)} ${text(form?.Content)}`])].some(form => normalize(form) === target)).slice(0, 20).map(entry => ({
    headword: text(entry.Value).replace(/\|/g, ''),
    partOfSpeech: text(entry.Type),
    forms: list(entry.Inflection).slice(0, 30).map(form => ({ label: text(form?.Form), prefix: text(form?.Spec), form: text(form?.Content) })),
    meanings: list(entry.Lexeme).slice(0, 50).map(sense => ({
      definition: text(sense?.Definition?.Content), grammar: list(sense?.Graminfo).slice(0, 6).map(item => text(item?.Content)),
      constructions: list(sense?.Cycle).slice(0, 30).map(cycle => ({ definition: text(cycle?.Definition?.Content), comment: text(cycle?.Comment?.Content), grammar: list(cycle?.Graminfo).map(item => text(item?.Content)) })),
      expressions: list(sense?.Idioms).slice(0, 30).map(idiom => ({ expression: text(idiom?.Content), definition: text(idiom?.Definition?.Content) })),
    })),
  }));
}

async function lookupSwedish(word, language, { fetchImpl = fetch, signal } = {}) {
  if (!/^(swedish|svenska|sv|swe)(?:\s*\([^)]*\))?$/i.test(language.trim())) return null;
  signal?.throwIfAborted();
  const url = new URL(ENDPOINT);
  url.searchParams.set('searchinfo', `both,swe_swe,${word.trim()}`);
  url.searchParams.set('output', 'JSON');
  try {
    const response = await fetchImpl(url.href, {
      method: 'GET', redirect: 'error', headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const entries = dictionaryEntries(await response.json(), word);
    return entries.length ? { source: 'Lexin Swedish dictionary', entries } : null;
  } catch {
    // An unavailable dictionary must not stop generation; cancellation must.
    signal?.throwIfAborted();
    return null;
  }
}

module.exports = { lookupSwedish, dictionaryEntries };
