const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { createFixture, cleanupFixture, balanceOf } = require('./helpers/ledger-fixture');
const ledgerRepository = require('../src/modules/ledger/ledger.repository');
const { recordCrossCurrencyTransfer, InsufficientFundsError } = require('../src/modules/ledger/ledger.service');
const { getFxPoolAccountId } = require('../src/modules/fx/fx.repository');
const { compare, add, subtract } = require('../src/lib/money');

const PREFIX = 'ledger-cross';
let fx, receiverCadId, ngnPoolId, cadPoolId, poolStart;

before(async () => {
  fx = await createFixture(PREFIX, '1000');
  const { rows: [cad] } = await pool.query(
    `INSERT INTO accounts (user_id, currency) SELECT user_id, 'CAD' FROM accounts WHERE id = $1 RETURNING id`,
    [fx.receiverId]);
  receiverCadId = cad.id;
  ngnPoolId = await getFxPoolAccountId('NGN');
  cadPoolId = await getFxPoolAccountId('CAD');
  poolStart = { ngn: await balanceOf(ngnPoolId), cad: await balanceOf(cadPoolId) };
});

after(async () => {
  await cleanupFixture(PREFIX);
  await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart.ngn, ngnPoolId]);
  await pool.query('UPDATE accounts SET cached_balance = $1 WHERE id = $2', [poolStart.cad, cadPoolId]);
  await pool.end();
});

const transfer = (transferId, sourceAmount, destAmount) => recordCrossCurrencyTransfer({
  transferId,
  senderAccountId: fx.senderId,
  receiverAccountId: receiverCadId,
  sourcePoolAccountId: ngnPoolId,
  destPoolAccountId: cadPoolId,
  sourceAmount, sourceCurrency: 'NGN', destAmount, destCurrency: 'CAD',
});

const entryCount = async (transferId) => {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1', [transferId]);
  return rows[0].n;
};

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

test('writes 4 entries, each currency nets to zero, and all balances move correctly', async () => {
  const transferId = await fx.newTransfer('500');
  const { entries } = await transfer(transferId, '500', '0.455');
  assert.strictEqual(entries.length, 4);

  const { rows } = await pool.query(
    `SELECT currency, SUM(CASE WHEN direction = 'debit' THEN -amount ELSE amount END)::text AS net
     FROM ledger_entries WHERE transfer_id = $1 GROUP BY currency ORDER BY currency`, [transferId]);
  assert.deepStrictEqual(rows.map((r) => r.currency), ['CAD', 'NGN']);
  for (const r of rows) assert.strictEqual(compare(r.net, '0'), 0);

  assert.strictEqual(compare(await balanceOf(fx.senderId), '500'), 0);
  assert.strictEqual(compare(await balanceOf(receiverCadId), '0.455'), 0);
  assert.strictEqual(compare(await balanceOf(ngnPoolId), add(poolStart.ngn, '500')), 0);
  assert.strictEqual(compare(await balanceOf(cadPoolId), subtract(poolStart.cad, '0.455')), 0);
});

test('insufficient sender funds throws and writes nothing', async () => {
  const transferId = await fx.newTransfer('600');
  await assert.rejects(transfer(transferId, '600', '0.546'), InsufficientFundsError);
  assert.strictEqual(await entryCount(transferId), 0);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '500'), 0);
});

test('a failure on the final entry rolls back all four legs', async () => {
  const transferId = await fx.newTransfer('100');
  const poolsBefore = [await balanceOf(ngnPoolId), await balanceOf(cadPoolId)];
  const restore = failOnNthCall('insertEntry', 4);
  try {
    await assert.rejects(transfer(transferId, '100', '0.091'), /simulated failure/);
  } finally {
    restore();
  }
  assert.strictEqual(await entryCount(transferId), 0);
  assert.strictEqual(compare(await balanceOf(fx.senderId), '500'), 0);
  assert.strictEqual(compare(await balanceOf(receiverCadId), '0.455'), 0);
  assert.strictEqual(compare(await balanceOf(ngnPoolId), poolsBefore[0]), 0);
  assert.strictEqual(compare(await balanceOf(cadPoolId), poolsBefore[1]), 0);
});