const { test, before, after } = require('node:test');
const assert = require('node:assert');
const redis = require('../src/config/redis');
const { getRate, cacheKey, RATE_TTL_SECONDS } = require('../src/modules/fx/fx.service');

const PAIR = 'TEST_PAIR';

before(() => redis.del(cacheKey(PAIR)));
after(async () => {
  await redis.del(cacheKey(PAIR));
  await redis.quit();
});

test('second call within TTL returns the cached rate even if the provider fails', async () => {
  let calls = 0;
  const provider = async () => {
    calls++;
    if (calls > 1) throw new Error('provider down');
    return '123.45';
  };
  const first = await getRate(PAIR, provider);
  const second = await getRate(PAIR, provider);
  assert.strictEqual(first, '123.45');
  assert.strictEqual(second, first);
  assert.strictEqual(calls, 1);
});

test('cached rate has a TTL set', async () => {
  const ttl = await redis.ttl(cacheKey(PAIR));
  assert.ok(ttl > 0 && ttl <= RATE_TTL_SECONDS, `ttl was ${ttl}`);
});