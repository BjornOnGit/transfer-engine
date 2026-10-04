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

module.exports = { insertLock };