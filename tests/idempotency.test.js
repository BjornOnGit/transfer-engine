const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const pool = require('../src/config/database');
const redis = require('../src/config/redis');
const idempotency = require('../src/middleware/idempotency.middleware');
const errorHandler = require('../src/middleware/error-handler');

const USER = 'idem-test-user';
let handled = 0;
let server;
let url;

const cleanup = async () => {
  await pool.query('DELETE FROM idempotency_keys WHERE key LIKE $1', [`${USER}:%`]);
  const keys = await redis.keys(`idem:${USER}:*`);
  if (keys.length) await redis.del(keys);
};

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: USER }; next(); });
  app.post('/thing', idempotency, async (req, res) => {
    handled++;
    await new Promise((r) => setTimeout(r, 300));
    res.status(201).json({ run: handled, echoed: req.body });
  });
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  url = `http://localhost:${server.address().port}/thing`;
});

after(async () => {
  await cleanup();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await redis.quit();
});

async function post(key, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), replay: r.headers.get('idempotent-replay') };
}

test('same key sent concurrently runs once and both responses are identical', async () => {
  const [a, b] = await Promise.all([post('k1', { amount: 5 }), post('k1', { amount: 5 })]);
  assert.strictEqual(handled, 1);
  assert.strictEqual(a.status, 201);
  assert.deepStrictEqual(a.body, b.body);
  assert.strictEqual(a.status, b.status);
});

test('same key sent again later replays the stored response', async () => {
  const again = await post('k1', { amount: 5 });
  assert.strictEqual(handled, 1);
  assert.strictEqual(again.status, 201);
  assert.strictEqual(again.body.run, 1);
  assert.strictEqual(again.replay, 'true');
});

test('same key with a different body is rejected with 422', async () => {
  const r = await post('k1', { amount: 999 });
  assert.strictEqual(r.status, 422);
  assert.strictEqual(r.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.strictEqual(handled, 1);
});

test('missing Idempotency-Key is rejected with 400', async () => {
  const r = await post(null, { amount: 5 });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('a different key is processed as a new request', async () => {
  const r = await post('k2', { amount: 5 });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.run, 2);
  assert.strictEqual(handled, 2);
});