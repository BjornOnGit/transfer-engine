const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/database');
const { getFxPoolAccountId } = require('../src/modules/fx/fx.repository');

after(() => pool.end());

test('finds a distinct pool account for each supported currency', async () => {
  const ngn = await getFxPoolAccountId('NGN');
  const cad = await getFxPoolAccountId('CAD');
  assert.ok(ngn && cad);
  assert.notStrictEqual(ngn, cad);
});

test('pool accounts start at a zero balance with the right currency', async () => {
  const { rows } = await pool.query(
    `SELECT currency, cached_balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY currency`,
    [[await getFxPoolAccountId('NGN'), await getFxPoolAccountId('CAD')]]
  );
  assert.deepStrictEqual(rows.map((r) => r.currency), ['CAD', 'NGN']);
});

test('an unsupported currency throws UNSUPPORTED_CURRENCY', async () => {
  await assert.rejects(getFxPoolAccountId('XXX'), { code: 'UNSUPPORTED_CURRENCY' });
});