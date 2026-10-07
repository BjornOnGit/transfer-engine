const pool = require('../../config/database');

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

async function insertEntry(client, { transferId, accountId, direction, amount, currency }) {
  const { rows } = await client.query(
    `INSERT INTO ledger_entries (transfer_id, account_id, direction, amount, currency)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, transfer_id, account_id, direction, amount, currency, created_at`,
    [transferId, accountId, direction, amount, currency]
  );
  return rows[0];
}

// Keeps accounts.cached_balance in sync. Also guards against a currency mismatch.
async function applyBalanceChange(client, accountId, amount, currency, direction) {
  const { rowCount } = await client.query(
    `UPDATE accounts
     SET cached_balance = CASE WHEN $3::text = 'debit'
                               THEN cached_balance - $1::numeric
                               ELSE cached_balance + $1::numeric END
     WHERE id = $2 AND currency = $4`,
    [amount, accountId, direction, currency]
  );
  if (rowCount !== 1) {
    throw httpError(422, 'ACCOUNT_MISMATCH', 'Account not found or currency does not match');
  }
}

// Balance derived purely from ledger entries, independent of accounts.cached_balance.
async function getBalanceFromLedger(accountId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance
     FROM ledger_entries WHERE account_id = $1`,
    [accountId]
  );
  return rows[0].balance;
}

// Locks the rows (in id order, to avoid deadlocks) until the surrounding transaction ends.
async function lockAccounts(client, accountIds) {
  const { rows } = await client.query(
    'SELECT id, cached_balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [accountIds]
  );
  return rows;
}

module.exports = { insertEntry, applyBalanceChange, getBalanceFromLedger, lockAccounts };