// Existing language fixtures stand in for a successful semantic review. Tests
// for incomplete coverage call the real generator without this adapter.
const { generateEntry } = require('../src/core.cjs');
exports.generateEntry = (word, settings, key, options) => generateEntry(word, settings, key, {
  ...options,
  fetchImpl: async (url, request) => {
    const response = await options.fetchImpl(url, request);
    if (!String(url).includes('api.openai.com') || !response.ok) return response;
    const body = JSON.parse(request.body), input = JSON.parse(body.input);
    if (!input.senseCandidates) return response;
    const data = await response.json();
    for (const part of (data.output || []).flatMap(item => item.content || [])) {
      if (part.type !== 'output_text') continue;
      const entry = JSON.parse(part.text);
      entry.senseChecks = input.senseCandidates.map(candidate => ({ id: candidate.id, status: 'covered', meaningIndexes: [candidate.id.startsWith('dictionary:') ? 0 : Number(candidate.id.split(':')[1])], reason: '' }));
      part.text = JSON.stringify(entry);
    }
    return { ...response, json: async () => data };
  },
});
