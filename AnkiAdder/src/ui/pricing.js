(function (root) {
  // Standard API prices, USD / 1 million tokens. Keep historical receipts unchanged.
  const checked = '2026-09-11';
  const source = 'https://developers.openai.com/api/docs/pricing';
  const rates = {
    'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20 },
    'gpt-5.6-terra': { input: 2, cached: 0.20, output: 12 },
    'gpt-5.6-sol': { input: 4, cached: 0.40, output: 20 },
    'gpt-6-astra': { input: 10, cached: 1, output: 50 },
    'gpt-4o-mini-tts': { input: 0.60, cached: 0.60, output: 12 },
  };
  function calculate(model, usage, tier = 'default') {
    const rate = rates[model];
    const input = usage?.input_tokens, output = usage?.output_tokens;
    const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
    if (!rate || !['default', 'auto', undefined, null].includes(tier) || ![input, output, cached].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input || input > 272000) {
      return { usd: null, basis: 'unavailable', model, checked, reason: !rate ? 'No saved price for this model' : 'Usage or supported pricing unavailable' };
    }
    return { usd: ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1e6, basis: 'usage', model, usage: { input, output, cached }, rates: { ...rate }, checked };
  }
  const zero = reason => ({ usd: 0, basis: reason, checked });
  function combine(receipts) {
    return { usd: receipts.length && receipts.every(cost => cost.usd != null) ? receipts.reduce((sum, cost) => sum + cost.usd, 0) : null, basis: 'requests', receipts: [...receipts] };
  }
  function estimate(model, audioEnabled) {
    const text = combine([calculate(model, { input_tokens: 1000, output_tokens: 1000 }), calculate(model, { input_tokens: 2000, output_tokens: 1000 })]);
    const pronunciation = audioEnabled ? calculate('gpt-4o-mini-tts', { input_tokens: 100, output_tokens: 75 }) : zero('off');
    return { text, pronunciation };
  }
  function amount(cost) {
    if (cost?.usd == null) return 'unavailable';
    if (cost.usd === 0) return '$0';
    return cost.usd < 0.00001 ? '<$0.00001' : `$${cost.usd.toFixed(5)}`;
  }
  const api = { checked, source, rates, calculate, combine, zero, estimate, amount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnkiPricing = api;
})(typeof window !== 'undefined' ? window : globalThis);
