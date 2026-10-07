const crypto = require('crypto');
const pool = require('../config/database');
const redis = require('../config/redis');

const LOCK_TTL_SECONDS = 30;
const WAIT_TIMEOUT_MS = 10000;
const WAIT_INTERVAL_MS = 100;

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

async function findRecord(key) {
  const { rows } = await pool.query(
    'SELECT request_hash, response_snapshot FROM idempotency_keys WHERE key = $1 AND response_snapshot IS NOT NULL',
    [key]
  );
  return rows[0];
}

async function waitForRecord(key) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const record = await findRecord(key);
    if (record) return record;
    await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
  }
  return null;
}

const release = (redisKey, token) => redis.eval(RELEASE_SCRIPT, 1, redisKey, token);

function persistOnResponse(res, { key, hash, redisKey, token }) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    const saved = status < 500
      ? pool.query(
          `INSERT INTO idempotency_keys (key, request_hash, response_snapshot)
           VALUES ($1, $2, $3::jsonb) ON CONFLICT (key) DO NOTHING`,
          [key, hash, JSON.stringify({ status, body })]
        )
      : Promise.resolve();
    saved
      .catch((err) => console.error('[idempotency] failed to store response', err))
      .then(() => release(redisKey, token))
      .catch((err) => console.error('[idempotency] failed to release lock', err))
      .then(() => originalJson(body));
    return res;
  };
}

module.exports = async (req, res, next) => {
  try {
    const header = req.get('Idempotency-Key');
    if (!header) {
      return next(httpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required'));
    }

    const key = `${req.user.id}:${header}`;
    const redisKey = `idem:${key}`;
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify([req.method, req.originalUrl, req.body || {}]))
      .digest('hex');

    let record = await findRecord(key);

    if (!record) {
      const token = crypto.randomUUID();
      const acquired = await redis.set(redisKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');

      if (acquired) {
        // re-check: a previous holder may have finished between our lookup and the lock
        record = await findRecord(key);
        if (!record) {
          persistOnResponse(res, { key, hash, redisKey, token });
          return next();
        }
        await release(redisKey, token);
      } else {
        record = await waitForRecord(key);
        if (!record) {
          return next(httpError(409, 'REQUEST_IN_PROGRESS', 'A request with this key is still processing'));
        }
      }
    }

    if (record.request_hash !== hash) {
      return next(httpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request'));
    }
    const { status, body } = record.response_snapshot;
    res.set('Idempotent-Replay', 'true').status(status).json(body);
  } catch (err) {
    next(err);
  }
};