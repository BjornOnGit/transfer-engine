const { test, before, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../src/config/env');
const app = require('../src/app');
const pool = require('../src/config/database');
const { notificationQueue, connection } = require('../src/lib/queue');

let server, base;
const token = jwt.sign({ sub: 'validation-test-user' }, jwtSecret);

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await notificationQueue.close();
  await pool.end();
  await connection.quit();
});

async function post(path, body, { auth = false, raw = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const fieldsOf = (r) => r.body.error.details.map((d) => d.field).sort();

test('signup: empty body lists every missing field', async () => {
  const r = await post('/auth/signup', {});
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'VALIDATION_ERROR');
  assert.deepStrictEqual(fieldsOf(r), ['email', 'name', 'password']);
});

test('signup: bad email and short password are reported per field', async () => {
  const r = await post('/auth/signup', { name: 'A', email: 'not-an-email', password: 'short' });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(fieldsOf(r), ['email', 'password']);
});

test('login: missing password is reported', async () => {
  const r = await post('/auth/login', { email: 'a@b.com' });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(fieldsOf(r), ['password']);
});

test('accounts: invalid currency is reported', async () => {
  const r = await post('/accounts', { currency: 'NG' }, { auth: true });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(fieldsOf(r), ['currency']);
});

test('transfers: bad ids and amount are reported per field', async () => {
  const r = await post('/transfers', { senderAccountId: 'x', receiverAccountId: 'y', amount: 'abc' }, { auth: true });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(fieldsOf(r), ['amount', 'receiverAccountId', 'senderAccountId']);
});

test('transfers: zero and over-precise amounts are rejected', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const amount of ['0', '0.00', '10.123', -5]) {
    const r = await post('/transfers', { senderAccountId: id, receiverAccountId: id, amount }, { auth: true });
    assert.strictEqual(r.status, 400, `amount ${amount}`);
    assert.deepStrictEqual(fieldsOf(r), ['amount']);
  }
});

test('malformed JSON returns 400, not 500', async () => {
  const r = await post('/auth/signup', '{"name": ', { raw: true });
  assert.strictEqual(r.status, 400);
});