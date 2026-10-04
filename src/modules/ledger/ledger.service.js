const pool = require('../../config/database');
const ledgerRepository = require('./ledger.repository');
const { compare } = require('../../lib/money');

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

async function recordTransfer(transferId, debitAccountId, creditAccountId, amount, currency) {
  if (compare(amount, '0') <= 0) throw httpError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (debitAccountId === creditAccountId) {
    throw httpError(400, 'SAME_ACCOUNT', 'Debit and credit accounts must differ');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const debit = await ledgerRepository.insertEntry(client, {
      transferId, accountId: debitAccountId, direction: 'debit', amount, currency,
    });
    await ledgerRepository.applyBalanceChange(client, debitAccountId, amount, currency, 'debit');
    const credit = await ledgerRepository.insertEntry(client, {
      transferId, accountId: creditAccountId, direction: 'credit', amount, currency,
    });
    await ledgerRepository.applyBalanceChange(client, creditAccountId, amount, currency, 'credit');
    await client.query('COMMIT');
    return { debit, credit };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordTransfer };