const test = require('node:test');
const assert = require('node:assert');
const { fetchProviderRate } = require('../src/modules/fx/fx.service');

test('returns a positive string rate for both directions', () => {
  for (const pair of ['NGN_CAD', 'CAD_NGN']) {
    const rate = fetchProviderRate(pair);
    assert.strictEqual(typeof rate, 'string');
    assert.ok(Number(rate) > 0);
  }
});

test('NGN_CAD and CAD_NGN are roughly reciprocal', () => {
  const product = Number(fetchProviderRate('NGN_CAD')) * Number(fetchProviderRate('CAD_NGN'));
  assert.ok(product > 0.98 && product < 1.02, `product was ${product}`);
});

test('rate stays within 0.5% of base', () => {
  for (let i = 0; i < 50; i++) {
    const rate = Number(fetchProviderRate('CAD_NGN'));
    assert.ok(rate >= 1094.5 && rate <= 1105.5, `rate was ${rate}`);
  }
});

test('unknown pair throws', () => {
  assert.throws(() => fetchProviderRate('USD_JPY'), { code: 'UNSUPPORTED_PAIR' });
});