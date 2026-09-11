const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, estimate, amount } = require('../src/ui/pricing.js');
const { validateSettings } = require('../src/core.cjs');

test('Luna price calculation applies cached-input discount and counts reasoning within output once', () => {
  const cost = calculate('gpt-5.6-luna', { input_tokens: 1000, output_tokens: 1000, input_tokens_details: { cached_tokens: 500 }, output_tokens_details: { reasoning_tokens: 200 } });
  assert.equal(cost.usd, 0.00131);
  assert.equal(cost.usage.output, 1000); assert.equal(cost.usage.cached, 500);
  assert.equal(amount(cost), '$0.00131');
});
test('unknown models and missing, malformed or unsupported usage never display a fabricated zero', () => {
  for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 1 }, { input_tokens: 1, output_tokens: NaN }, { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } }, { input_tokens: 300000, output_tokens: 1 }]) assert.equal(calculate('gpt-5.6-luna', usage).usd, null);
  assert.equal(calculate('unknown', { input_tokens: 1, output_tokens: 1 }).usd, null);
  assert.equal(calculate('gpt-5.6-luna', { input_tokens: 1, output_tokens: 1 }, 'priority').usd, null);
  assert.equal(amount(undefined), 'unavailable');
});
test('illustrative estimate and independent toggles preserve explicit off choices', () => {
  assert.equal(estimate('gpt-5.6-luna', true).text.usd, 0.0014);
  assert.equal(estimate('gpt-5.6-luna', true).pronunciation.usd, 0.00096);
  assert.equal(estimate('gpt-5.6-luna', false).pronunciation.usd, 0);
  assert.equal(validateSettings({}).showCosts, true);
  assert.equal(validateSettings({ audioEnabled: false, showCosts: false }).audioEnabled, false);
  assert.equal(validateSettings({ audioEnabled: false, showCosts: false }).showCosts, false);
});
