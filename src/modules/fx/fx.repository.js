const pool = require('../../config/database');

// `db` can be the pool or a transaction client, so the orchestration (7.3) can run this inside a transaction
async function insertLock(db = pool, { transferId, rate, sourceCurrency, destCurrency, ttlMinutes }) {
  const { rows } = await db.query(
    `INSERT INTO fx_rate_locks (transfer_id, rate, source_currency, dest_currency, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5::int))
     RETURNING id, transfer_id, rate, source_currency, dest_currency, locked_at, expires_at`,
    [transferId, rate, sourceCurrency, destCurrency, ttlMinutes]
  );
  return rows[0];
}

const FX_POOL_EMAIL = 'fx-pool@system.internal';

async function getFxPoolAccountId(currency, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id
     WHERE u.email = $1 AND a.currency = $2`,
    [FX_POOL_EMAIL, currency]
  );
  if (!rows[0]) {
    throw Object.assign(new Error(`No FX pool account for ${currency}`), {
      status: 422,
      code: 'UNSUPPORTED_CURRENCY',
    });
  }
  return rows[0].id;
}

module.exports = { insertLock, getFxPoolAccountId };