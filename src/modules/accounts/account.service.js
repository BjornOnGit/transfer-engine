const pool = require('../../config/database');

async function createAccount(userId, currency) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (user_id, currency)
       VALUES ($1, $2)
       RETURNING id, user_id, currency, cached_balance, created_at`,
      [userId, currency]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error(`You already have a ${currency} account`);
      e.status = 409;
      e.code = 'ACCOUNT_EXISTS';
      throw e;
    }
    throw err;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

async function getAccountForUser(accountId, userId) {
  if (!UUID_RE.test(accountId)) throw httpError(404, 'NOT_FOUND', 'Account not found');

  const { rows } = await pool.query(
    'SELECT id, user_id, currency, cached_balance, created_at FROM accounts WHERE id = $1',
    [accountId]
  );
  const account = rows[0];
  if (!account) throw httpError(404, 'NOT_FOUND', 'Account not found');
  if (account.user_id !== userId) throw httpError(403, 'FORBIDDEN', 'Not your account');
  return account;
}

async function listAccountsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, currency, cached_balance, created_at
     FROM accounts WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows;
}

module.exports = { createAccount, getAccountForUser, listAccountsForUser };