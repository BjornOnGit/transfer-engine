const pool = require('../../config/database');
const ledgerRepository = require('./ledger.repository');
const { compare } = require('../../lib/money');

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds') {
    super(message);
    this.name = 'InsufficientFundsError';
    this.status = 422;
    this.code = 'INSUFFICIENT_FUNDS';
  }
}

async function recordTransfer(transferId, debitAccountId, creditAccountId, amount, currency) {
  if (compare(amount, '0') <= 0) throw httpError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (debitAccountId === creditAccountId) {
    throw httpError(400, 'SAME_ACCOUNT', 'Debit and credit accounts must differ');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await ledgerRepository.lockAccounts(client, [debitAccountId, creditAccountId]);
    if (locked.length !== 2) throw httpError(422, 'ACCOUNT_MISMATCH', 'Account not found');
    const debitAccount = locked.find((a) => a.id === debitAccountId);
    if (compare(debitAccount.cached_balance, amount) < 0) throw new InsufficientFundsError();

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

module.exports = { recordTransfer, InsufficientFundsError };