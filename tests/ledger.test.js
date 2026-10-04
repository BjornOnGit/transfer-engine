const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { recordTransfer } = require('../src/modules/ledger/ledger.service');
const { compare } = require('../src/lib/money');

const PREFIX = 'ledger';
let fx;

before(async () => { fx = await createFixture(PREFIX, '1000'); });
after(async () => {
  await cleanupFixture(PREFIX);
  await pool.end();
});

test('writes one debit and one credit that net to zero, and moves both balances', async () => {
  const transferId = await fx.newTransfer('250.50');
  await recordTransfer(transferId, fx.senderId, fx.receiverId, '250.50', 'NGN');

  const { rows } = await pool.query(
    'SELECT direction FROM ledger_entries WHERE transfer_id = $1', [transferId]);
  assert.deepStrictEqual(rows.map((r) => r.direction).sort(), ['credit', 'debit']);

  const { rows: [{ net }] } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN -amount ELSE amount END), 0)::text AS net
     FROM ledger_entries WHERE transfer_id = $1`, [transferId]);
  assert.strictEqual(compare(net, '0'), 0);

  assert.strictEqual(compare(await balanceOf(fx.senderId), '749.50'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '250.50'), 0);
});

test('rejects a non-positive amount', async () => {
  const transferId = await fx.newTransfer();
  await assert.rejects(
    recordTransfer(transferId, fx.senderId, fx.receiverId, '0', 'NGN'),
    { code: 'INVALID_AMOUNT' });
});

test('rejects debiting and crediting the same account', async () => {
  const transferId = await fx.newTransfer();
  await assert.rejects(
    recordTransfer(transferId, fx.senderId, fx.senderId, '10', 'NGN'),
    { code: 'SAME_ACCOUNT' });
});