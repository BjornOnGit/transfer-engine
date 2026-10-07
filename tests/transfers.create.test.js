const { test, before, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../src/config/env');
const app = require('../src/app');
const pool = require('../src/config/database');
const redis = require('../src/config/redis');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { getFxPoolAccountId } = require('../src/modules/fx/fx.repository');
const { compare, multiply, format } = require('../src/lib/money');

const PREFIX = 't73';
let fx, server, base, receiverCadId, senderUserId, receiverUserId, poolIds, poolStart, first;

const tokenFor = (id) => jwt.sign({ sub: id }, jwtSecret);
const userIdOf = async (email) =>
  (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;

const post = async (token, key, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(`${base}/transfers`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), replay: r.headers.get('idempotent-replay') };
};

const get = async (token, id) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(`${base}/transfers/${id}`, { headers });
  return { status: r.status, body: await r.json() };
};

const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;

before(async () => {
  fx = await createFixture(PREFIX, '1000');
  const { rows: [cad] } = await pool.query(
    `INSERT INTO accounts (user_id, currency) SELECT user_id, 'CAD' FROM accounts WHERE id = $1 RETURNING id`,
    [fx.receiverId]);
  receiverCadId = cad.id;
  senderUserId = await userIdOf(`${PREFIX}-sender@test.com`);
  receiverUserId = await userIdOf(`${PREFIX}-receiver@test.com`);
  poolIds = [await getFxPoolAccountId('NGN'), await getFxPoolAccountId('CAD')];
  poolStart = [await balanceOf(poolIds[0]), await balanceOf(poolIds[1])];
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  try {
    await pool.query('DELETE FROM idempotency_keys WHERE key LIKE $1 OR key LIKE $2',
      [`${senderUserId}:%`, `${receiverUserId}:%`]);
    await cleanupFixture(PREFIX);
    await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart[0], poolIds[0]]);
    await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart[1], poolIds[1]]);
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await redis.quit();
  }
});

test('valid request completes with one rate lock and balanced ledger entries', async () => {
  const r = await post(tokenFor(senderUserId), 'k1', {
    senderAccountId: fx.senderId, receiverAccountId: receiverCadId, amount: '500',
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.status, 'completed');
  first = r.body;

  const id = r.body.id;
  assert.strictEqual(await count('SELECT count(*)::int AS n FROM fx_rate_locks WHERE transfer_id = $1', [id]), 1);
  assert.strictEqual(await count('SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1', [id]), 4);

  const { rows } = await pool.query(
    `SELECT SUM(CASE WHEN direction = 'debit' THEN -amount ELSE amount END)::text AS net
     FROM ledger_entries WHERE transfer_id = $1 GROUP BY currency`, [id]);
  assert.strictEqual(rows.length, 2);
  for (const row of rows) assert.strictEqual(compare(row.net, '0'), 0);

  const expectedDest = format(multiply('500', r.body.locked_rate.rate), 2);
  assert.strictEqual(r.body.dest_amount, expectedDest);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '500'), 0);
  assert.strictEqual(compare(await balanceOf(receiverCadId), expectedDest), 0);
});

test('repeating the same Idempotency-Key replays the response and creates no second transfer', async () => {
  const r = await post(tokenFor(senderUserId), 'k1', {
    senderAccountId: fx.senderId, receiverAccountId: receiverCadId, amount: '500',
  });
  assert.strictEqual(r.status, 201);
  assert.deepStrictEqual(r.body, first);
  assert.strictEqual(r.replay, 'true');
  assert.strictEqual(
    await count('SELECT count(*)::int AS n FROM transfers WHERE sender_account_id = $1', [fx.senderId]), 1);
});

test("sending from someone else's account is rejected with 403", async () => {
  const r = await post(tokenFor(receiverUserId), 'k2', {
    senderAccountId: fx.senderId, receiverAccountId: receiverCadId, amount: '10',
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(
    await count('SELECT count(*)::int AS n FROM transfers WHERE sender_account_id = $1', [fx.senderId]), 1);
});

test('same-currency transfer is rejected with 400', async () => {
  const r = await post(tokenFor(senderUserId), 'k3', {
    senderAccountId: fx.senderId, receiverAccountId: fx.receiverId, amount: '10',
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'SAME_CURRENCY');
});

test('missing Idempotency-Key is rejected with 400', async () => {
  const r = await post(tokenFor(senderUserId), null, {
    senderAccountId: fx.senderId, receiverAccountId: receiverCadId, amount: '10',
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('the sender can read the transfer, including its locked rate', async () => {
  const r = await get(tokenFor(senderUserId), first.id);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, first);
  assert.ok(r.body.locked_rate.rate);
});

test('the receiver can read the transfer', async () => {
  const r = await get(tokenFor(receiverUserId), first.id);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.id, first.id);
});

test('a third party gets 403', async () => {
  const { rows: [third] } = await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ('Third', 't73-third@test.com', 'x') RETURNING id`);
  try {
    const r = await get(tokenFor(third.id), first.id);
    assert.strictEqual(r.status, 403);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [third.id]);
  }
});

test('unknown and malformed ids return 404, and no token returns 401', async () => {
  const token = tokenFor(senderUserId);
  assert.strictEqual((await get(token, '00000000-0000-0000-0000-000000000000')).status, 404);
  assert.strictEqual((await get(token, 'not-a-uuid')).status, 404);
  assert.strictEqual((await get(null, first.id)).status, 401);
});