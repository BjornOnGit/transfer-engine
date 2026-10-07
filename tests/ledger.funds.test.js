const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { recordTransfer, InsufficientFundsError } = require('../src/modules/ledger/ledger.service');
const { compare } = require('../src/lib/money');

const PREFIX = 'ledger-funds';
let fx;

before(async () => { fx = await createFixture(PREFIX, '100'); });
after(async () => {
  await cleanupFixture(PREFIX);
  await pool.end();
});

test('debiting more than the balance throws InsufficientFundsError and writes nothing', async () => {
  const transferId = await fx.newTransfer('100.01');
  await assert.rejects(
    recordTransfer(transferId, fx.senderId, fx.receiverId, '100.01', 'NGN'),
    (err) => {
      assert.ok(err instanceof InsufficientFundsError);
      assert.strictEqual(err.code, 'INSUFFICIENT_FUNDS');
      return true;
    });

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1', [transferId]);
  assert.strictEqual(rows[0].n, 0);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '100'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '0'), 0);
});

test('debiting exactly the balance succeeds and leaves zero', async () => {
  const transferId = await fx.newTransfer('100');
  await recordTransfer(transferId, fx.senderId, fx.receiverId, '100', 'NGN');
  assert.strictEqual(compare(await balanceOf(fx.senderId), '0'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '100'), 0);
});