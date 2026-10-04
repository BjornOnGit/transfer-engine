const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const redis = require('../src/config/redis');
const { lockRate } = require('../src/modules/fx/fx.service');

const EMAIL = 'fxlock@test.com';
const OWNED = `SELECT id FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email = $1)`;
let transferId;

async function cleanup() {
  await pool.query(`DELETE FROM fx_rate_locks WHERE transfer_id IN (SELECT id FROM transfers WHERE sender_account_id IN (${OWNED}))`, [EMAIL]);
  await pool.query(`DELETE FROM transfers WHERE sender_account_id IN (${OWNED})`, [EMAIL]);
  await pool.query(`DELETE FROM accounts WHERE id IN (${OWNED})`, [EMAIL]);
  await pool.query('DELETE FROM users WHERE email = $1', [EMAIL]);
}

before(async () => {
  await cleanup();
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ('Fx Lock', $1, 'x') RETURNING id`, [EMAIL]);
  const { rows: [ngn] } = await pool.query(
    `INSERT INTO accounts (user_id, currency) VALUES ($1, 'NGN') RETURNING id`, [user.id]);
  const { rows: [cad] } = await pool.query(
    `INSERT INTO accounts (user_id, currency) VALUES ($1, 'CAD') RETURNING id`, [user.id]);
  const { rows: [transfer] } = await pool.query(
    `INSERT INTO transfers (sender_account_id, receiver_account_id, source_currency, dest_currency, amount)
     VALUES ($1, $2, 'NGN', 'CAD', 100) RETURNING id`, [ngn.id, cad.id]);
  transferId = transfer.id;
});

after(async () => {
  await cleanup();
  await pool.end();
  await redis.quit();
});

test('lockRate writes a lock tied to the transfer', async () => {
  const lock = await lockRate(transferId, 'NGN_CAD');
  assert.strictEqual(lock.transfer_id, transferId);
  assert.strictEqual(lock.source_currency, 'NGN');
  assert.strictEqual(lock.dest_currency, 'CAD');
  assert.ok(Number(lock.rate) > 0);
  assert.ok(new Date(lock.expires_at) > new Date(lock.locked_at));
});

test('locking the same transfer again fails and leaves exactly one lock', async () => {
  await assert.rejects(lockRate(transferId, 'NGN_CAD'), { code: 'RATE_ALREADY_LOCKED' });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM fx_rate_locks WHERE transfer_id = $1', [transferId]);
  assert.strictEqual(rows[0].n, 1);
});