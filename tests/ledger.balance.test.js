const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { recordTransfer } = require('../src/modules/ledger/ledger.service');
const { getBalanceFromLedger } = require('../src/modules/ledger/ledger.repository');
const { compare, add } = require('../src/lib/money');

const PREFIX = 'ledger-balance';
let fx;

before(async () => {
  fx = await createFixture(PREFIX, '1000');
  // sender -> receiver 250.50, then receiver -> sender 100 (exercises both directions)
  await recordTransfer(await fx.newTransfer('250.50'), fx.senderId, fx.receiverId, '250.50', 'NGN');
  await recordTransfer(await fx.newTransfer('100'), fx.receiverId, fx.senderId, '100', 'NGN');
});

after(async () => {
  await cleanupFixture(PREFIX);
  await pool.end();
});

test('ledger-derived balance matches cached_balance exactly', async () => {
  // The receiver started at 0 with no unbacked opening balance, so the two must agree.
  const fromLedger = await getBalanceFromLedger(fx.receiverId);
  assert.strictEqual(compare(fromLedger, '150.50'), 0);
  assert.strictEqual(compare(fromLedger, await balanceOf(fx.receiverId)), 0);
});

test('ledger balances of both accounts sum to zero', async () => {
  const sender = await getBalanceFromLedger(fx.senderId);
  const receiver = await getBalanceFromLedger(fx.receiverId);
  assert.strictEqual(compare(sender, '-150.50'), 0);
  assert.strictEqual(compare(add(sender, receiver), '0'), 0);
});

test('an account with no entries has a ledger balance of 0', async () => {
  assert.strictEqual(compare(await getBalanceFromLedger(randomUUID()), '0'), 0);
});