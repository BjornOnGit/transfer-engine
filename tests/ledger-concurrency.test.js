const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const { recordTransfer, InsufficientFundsError } = require('../src/modules/ledger/ledger.service');
const { compare } = require('../src/lib/money');

const PREFIX = 'ledger-conc';
let fx;

before(async () => { fx = await createFixture(PREFIX, '100'); });
after(async () => {
  await cleanupFixture(PREFIX);
  await pool.end();
});

const setBalances = async (sender, receiver) => {
  await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [sender, fx.senderId]);
  await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [receiver, fx.receiverId]);
};

const split = (results) => ({
  ok: results.filter((r) => r.status === 'fulfilled'),
  failed: results.filter((r) => r.status === 'rejected'),
});

test('two simultaneous transfers that together exceed the balance: exactly one succeeds', { timeout: 60000 }, async () => {
  await setBalances('100', '0');
  const ids = [await fx.newTransfer('60'), await fx.newTransfer('60')];

  const { ok, failed } = split(await Promise.allSettled(
    ids.map((id) => recordTransfer(id, fx.senderId, fx.receiverId, '60', 'NGN'))));

  assert.strictEqual(ok.length, 1);
  assert.strictEqual(failed.length, 1);
  assert.ok(failed[0].reason instanceof InsufficientFundsError);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '40'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '60'), 0);

  const { rows: [{ n }] } = await pool.query(
    'SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = ANY($1::uuid[])', [ids]);
  assert.strictEqual(n, 2); // one debit + one credit, from the winner only
});

test('five simultaneous transfers of 30 against a balance of 100: exactly three succeed', { timeout: 120000 }, async () => {
  await setBalances('100', '0');
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await fx.newTransfer('30'));

  const { ok, failed } = split(await Promise.allSettled(
    ids.map((id) => recordTransfer(id, fx.senderId, fx.receiverId, '30', 'NGN'))));

  assert.strictEqual(ok.length, 3);
  assert.strictEqual(failed.length, 2);
  for (const f of failed) assert.ok(f.reason instanceof InsufficientFundsError, String(f.reason));
  assert.strictEqual(compare(await balanceOf(fx.senderId), '10'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '90'), 0);
});

test('opposite-direction transfers at the same time do not deadlock', { timeout: 120000 }, async () => {
  await setBalances('100', '100');
  const forward = [];
  const backward = [];
  for (let i = 0; i < 3; i++) {
    forward.push(await fx.newTransfer('10'));
    backward.push(await fx.newTransfer('10'));
  }

  const results = await Promise.allSettled([
    ...forward.map((id) => recordTransfer(id, fx.senderId, fx.receiverId, '10', 'NGN')),
    ...backward.map((id) => recordTransfer(id, fx.receiverId, fx.senderId, '10', 'NGN')),
  ]);

  const { ok, failed } = split(results);
  assert.strictEqual(failed.length, 0, failed.map((f) => String(f.reason)).join('; '));
  assert.strictEqual(ok.length, 6);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '100'), 0);
  assert.strictEqual(compare(await balanceOf(fx.receiverId), '100'), 0);
});