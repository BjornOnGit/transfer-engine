const pool = require('../../src/config/database');

const emailsFor = (prefix) => [`${prefix}-sender@test.com`, `${prefix}-receiver@test.com`];
const OWNED = `SELECT id FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`;

async function cleanupFixture(prefix) {
  const e = [emailsFor(prefix)];
  await pool.query(`DELETE FROM ledger_entries WHERE account_id IN (${OWNED})`, e);
  await pool.query(`DELETE FROM fx_rate_locks WHERE transfer_id IN (SELECT id FROM transfers WHERE sender_account_id IN (${OWNED}))`, e);
  await pool.query(`DELETE FROM notification_deliveries WHERE transfer_id IN (SELECT id FROM transfers WHERE sender_account_id IN (${OWNED}))`, e);
  await pool.query(`DELETE FROM transfers WHERE sender_account_id IN (${OWNED})`, e);
  await pool.query(`DELETE FROM accounts WHERE id IN (${OWNED})`, e);
  await pool.query('DELETE FROM users WHERE email = ANY($1)', e);
}

async function createFixture(prefix, senderBalance = '1000') {
  await cleanupFixture(prefix);
  const [senderEmail, receiverEmail] = emailsFor(prefix);

  const makeAccount = async (email, balance) => {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [prefix, email]);
    const { rows: [account] } = await pool.query(
      `INSERT INTO accounts (user_id, currency, cached_balance) VALUES ($1, 'NGN', $2) RETURNING id`,
      [user.id, balance]);
    return account.id;
  };

  const senderId = await makeAccount(senderEmail, senderBalance);
  const receiverId = await makeAccount(receiverEmail, '0');

  const newTransfer = async (amount = '100') => {
    const { rows: [t] } = await pool.query(
      `INSERT INTO transfers (sender_account_id, receiver_account_id, source_currency, dest_currency, amount)
       VALUES ($1, $2, 'NGN', 'NGN', $3) RETURNING id`, [senderId, receiverId, amount]);
    return t.id;
  };

  return { senderId, receiverId, newTransfer };
}

async function balanceOf(accountId) {
  const { rows } = await pool.query('SELECT cached_balance FROM accounts WHERE id = $1', [accountId]);
  return rows[0].cached_balance;
}

module.exports = { createFixture, cleanupFixture, balanceOf };