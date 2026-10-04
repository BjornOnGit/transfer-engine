const { multiply } = require('../../lib/money');
const fxRepository = require('./fx.repository');

// Stand-in for a real FX provider. Rates are strings, never floats.
const BASE_RATES = { NGN_CAD: '0.00091', CAD_NGN: '1100' };

function fetchProviderRate(pair) {
  const base = BASE_RATES[pair];
  if (!base) {
    const e = new Error(`Unsupported currency pair: ${pair}`);
    e.status = 400;
    e.code = 'UNSUPPORTED_PAIR';
    throw e;
  }
  // random drift of -0.50% to +0.50%, computed in integer basis points
  const bps = Math.floor(Math.random() * 101) - 50;
  return multiply(multiply(base, String(10000 + bps)), '0.0001');
}

const RATE_TTL_SECONDS = 30;
const cacheKey = (pair) => `fx:rate:${pair}`;

async function refreshRate(pair, provider = fetchProviderRate) {
  const redis = require('../../config/redis');
  const rate = await provider(pair);
  await redis.set(cacheKey(pair), rate, 'EX', RATE_TTL_SECONDS);
  return rate;
}

async function getRate(pair, provider = fetchProviderRate) {
  const redis = require('../../config/redis');
  const cached = await redis.get(cacheKey(pair));
  if (cached) return cached;
  return refreshRate(pair, provider);
}

const LOCK_TTL_MINUTES = 15;

async function lockRate(transferId, pair, db) {
  const rate = await getRate(pair);
  const [sourceCurrency, destCurrency] = pair.split('_');
  try {
    return await fxRepository.insertLock(db, {
      transferId,
      rate,
      sourceCurrency,
      destCurrency,
      ttlMinutes: LOCK_TTL_MINUTES,
    });
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('A rate is already locked for this transfer');
      e.status = 409;
      e.code = 'RATE_ALREADY_LOCKED';
      throw e;
    }
    throw err;
  }
}

module.exports = { fetchProviderRate, getRate, refreshRate, lockRate, RATE_TTL_SECONDS, cacheKey };