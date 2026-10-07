const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const ledgerRepository = require('../src/modules/ledger/ledger.repository');
const { recordTransfer } = require('../src/modules/ledger/ledger.service');
const { compare } = require('../src/lib/money');

const PREFIX = 'ledger-atomic';
let fx;

before(async () => { fx = await createFixture(PREFIX, '1000'); });
after(async () => {
  await cleanupFixture(PREFIX);
  await pool.end();
});

// Makes ledgerRepository[fnName] throw on its nth call; returns a function that restores it.
function failOnNthCall(fnName, n) {
  const original = ledgerRepository[fnName];
  let calls = 0;
  ledgerRepository[fnName] = async (...args) => {
    calls++;
    if (calls === n) throw new Error('simulated failure');
    return original(...args);
  };
  return () => { ledgerRepository[fnName] = original; };
}

for (const fnName of ['insertEntry', 'applyBalanceChange']) {
  test(`rolls back everything when ${fnName} fails on the credit leg`, async () => {
    const transferId = await fx.newTransfer('100');
    const senderBefore = await balanceOf(fx.senderId);
    const receiverBefore = await balanceOf(fx.receiverId);

    const restore = failOnNthCall(fnName, 2);
    try {
      await assert.rejects(
        recordTransfer(transferId, fx.senderId, fx.receiverId, '100', 'NGN'),
        /simulated failure/
      );
    } finally {
      restore();
    }

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1', [transferId]);
    assert.strictEqual(rows[0].n, 0);
    assert.strictEqual(compare(await balanceOf(fx.senderId), senderBefore), 0);
    assert.strictEqual(compare(await balanceOf(fx.receiverId), receiverBefore), 0);
  });
}

test('a normal transfer still succeeds after the failures (no leaked connection or state)', async () => {
  const transferId = await fx.newTransfer('100');
  const senderBefore = await balanceOf(fx.senderId);
  await recordTransfer(transferId, fx.senderId, fx.receiverId, '100', 'NGN');
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1', [transferId]);
  assert.strictEqual(rows[0].n, 2);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '900'), 0);
  assert.ok(compare(await balanceOf(fx.senderId), senderBefore) < 0);
});