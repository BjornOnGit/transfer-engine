const pool = require('../../config/database');

async function findAccount(id) {
  const { rows } = await pool.query('SELECT id, user_id, currency FROM accounts WHERE id = $1', [id]);
  return rows[0];
}

async function insertTransfer({ senderAccountId, receiverAccountId, sourceCurrency, destCurrency, amount }) {
  const { rows } = await pool.query(
    `INSERT INTO transfers (sender_account_id, receiver_account_id, source_currency, dest_currency, amount)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [senderAccountId, receiverAccountId, sourceCurrency, destCurrency, amount]
  );
  return rows[0];
}

// Compare-and-set on status. Returns undefined if the transfer wasn't in `from`.
async function transition(id, from, to, { lockedRateId = null, db = pool } = {}) {
  const { rows } = await db.query(
    `UPDATE transfers
     SET status = $3, locked_rate_id = COALESCE($4, locked_rate_id), updated_at = now()
     WHERE id = $1 AND status = $2 RETURNING id`,
    [id, from, to, lockedRateId]
  );
  return rows[0];
}

async function getTransferWithLock(id) {
  const { rows } = await pool.query(
    `SELECT t.id, t.sender_account_id, t.receiver_account_id, t.source_currency, t.dest_currency,
            t.amount, t.status, t.created_at, t.updated_at,
            l.id AS lock_id, l.rate, l.locked_at, l.expires_at,
            sa.user_id AS sender_user_id, ra.user_id AS receiver_user_id
     FROM transfers t
     JOIN accounts sa ON sa.id = t.sender_account_id
     JOIN accounts ra ON ra.id = t.receiver_account_id
     LEFT JOIN fx_rate_locks l ON l.id = t.locked_rate_id
     WHERE t.id = $1`,
    [id]
  );
  return rows[0];
}

module.exports = { findAccount, insertTransfer, transition, getTransferWithLock };