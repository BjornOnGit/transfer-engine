process.env.NOTIFICATION_QUEUE_NAME = 'notification-queue-lifecycle-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Worker } = require('bullmq');
const app = require('../src/app');
const pool = require('../src/config/database');
const { notificationQueue, NOTIFICATION_QUEUE, connection } = require('../src/lib/queue');
const { cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { createProcessor } = require('../src/modules/notifications/dispatcher');
const { recordTransfer } = require('../src/modules/ledger/ledger.service');
const { getBalanceFromLedger } = require('../src/modules/ledger/ledger.repository');
const { getFxPoolAccountId } = require('../src/modules/fx/fx.repository');
const { compare, multiply, format } = require('../src/lib/money');

const PREFIX = 'lifecycle';
// Emails are named so cleanupFixture(PREFIX) removes both: the real user and the throwaway treasury.
const USER_EMAIL = `${PREFIX}-sender@test.com`;
const TREASURY_EMAIL = `${PREFIX}-receiver@test.com`;

let server, base, worker, userId, poolIds, poolStart;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', token, body, key } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(`${base}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  await cleanupFixture(PREFIX);
  poolIds = [await getFxPoolAccountId('NGN'), await getFxPoolAccountId('CAD')];
  poolStart = [await balanceOf(poolIds[0]), await balanceOf(poolIds[1])];
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  worker = new Worker(NOTIFICATION_QUEUE, createProcessor(), { connection });
  await worker.waitUntilReady();
});

after(async () => {
  try {
    if (userId) await pool.query('DELETE FROM idempotency_keys WHERE key LIKE $1', [`${userId}:%`]);
    await cleanupFixture(PREFIX);
    await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart[0], poolIds[0]]);
    await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart[1], poolIds[1]]);
  } finally {
    if (worker) await worker.close();
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await notificationQueue.obliterate({ force: true });
    await notificationQueue.close();
    await pool.end();
    await connection.quit();
  }
});

test('signup to completed transfer, with balanced ledger and a sent notification', { timeout: 120000 }, async () => {
  // 1. signup + login
  const signup = await api('/auth/signup', {
    method: 'POST', body: { name: 'Lifecycle User', email: USER_EMAIL, password: 's3cret-pass' },
  });
  assert.strictEqual(signup.status, 201);
  userId = signup.body.id;
  const login = await api('/auth/login', {
    method: 'POST', body: { email: USER_EMAIL, password: 's3cret-pass' },
  });
  assert.strictEqual(login.status, 200);
  const token = login.body.token;

  // 2. open an NGN and a CAD account
  const ngn = await api('/accounts', { method: 'POST', token, body: { currency: 'NGN' } });
  const cad = await api('/accounts', { method: 'POST', token, body: { currency: 'CAD' } });
  assert.strictEqual(ngn.status, 201);
  assert.strictEqual(cad.status, 201);
  const ngnId = ngn.body.id;
  const cadId = cad.body.id;

  // 3. fund the NGN account through the ledger, from a throwaway treasury account
  const { rows: [treasuryUser] } = await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ('Treasury', $1, 'x') RETURNING id`, [TREASURY_EMAIL]);
  const { rows: [treasury] } = await pool.query(
    `INSERT INTO accounts (user_id, currency, cached_balance) VALUES ($1, 'NGN', '1000000') RETURNING id`,
    [treasuryUser.id]);
  const { rows: [fundingTransfer] } = await pool.query(
    `INSERT INTO transfers (sender_account_id, receiver_account_id, source_currency, dest_currency, amount, status)
     VALUES ($1, $2, 'NGN', 'NGN', '1000', 'completed') RETURNING id`, [treasury.id, ngnId]);
  await recordTransfer(fundingTransfer.id, treasury.id, ngnId, '1000', 'NGN');

  const funded = await api(`/accounts/${ngnId}`, { token });
  assert.strictEqual(compare(funded.body.cached_balance, '1000'), 0);

  // 4. create the transfer: 500 NGN -> CAD
  const created = await api('/transfers', {
    method: 'POST', token, key: 'lifecycle-1',
    body: { senderAccountId: ngnId, receiverAccountId: cadId, amount: '500' },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.status, 'completed');
  const transferId = created.body.id;
  const destAmount = format(multiply('500', created.body.locked_rate.rate), 2);
  assert.strictEqual(created.body.dest_amount, destAmount);

  // 5. balanced ledger: 4 entries, each currency nets to zero, one rate lock
  const { rows: nets } = await pool.query(
    `SELECT currency, count(*)::int AS entries,
            SUM(CASE WHEN direction = 'debit' THEN -amount ELSE amount END)::text AS net
     FROM ledger_entries WHERE transfer_id = $1 GROUP BY currency ORDER BY currency`, [transferId]);
  assert.deepStrictEqual(nets.map((r) => [r.currency, r.entries]), [['CAD', 2], ['NGN', 2]]);
  for (const r of nets) assert.strictEqual(compare(r.net, '0'), 0);
  const { rows: [locks] } = await pool.query(
    'SELECT count(*)::int AS n FROM fx_rate_locks WHERE transfer_id = $1', [transferId]);
  assert.strictEqual(locks.n, 1);

  // 6. balances, and the ledger agrees with them
  const ngnAfter = await api(`/accounts/${ngnId}`, { token });
  const cadAfter = await api(`/accounts/${cadId}`, { token });
  assert.strictEqual(compare(ngnAfter.body.cached_balance, '500'), 0);
  assert.strictEqual(compare(cadAfter.body.cached_balance, destAmount), 0);
  assert.strictEqual(compare(await getBalanceFromLedger(ngnId), '500'), 0);
  assert.strictEqual(compare(await getBalanceFromLedger(cadId), destAmount), 0);

  // 7. the notification ends up sent, checked through the public endpoint
  let deliveries = [];
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const r = await api(`/transfers/${transferId}/notifications`, { token });
    deliveries = r.body.deliveries || [];
    if (deliveries.length && deliveries[0].status === 'sent') break;
    await sleep(500);
  }
  assert.strictEqual(deliveries.length, 1);
  assert.strictEqual(deliveries[0].status, 'sent');
  assert.strictEqual(deliveries[0].attempt_count, 1);
});