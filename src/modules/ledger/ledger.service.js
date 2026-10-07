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

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// One debit + one credit of the same amount and currency, with balances kept in sync.
async function writePair(client, { transferId, debitAccountId, creditAccountId, amount, currency }) {
  const debit = await ledgerRepository.insertEntry(client, {
    transferId, accountId: debitAccountId, direction: 'debit', amount, currency,
  });
  await ledgerRepository.applyBalanceChange(client, debitAccountId, amount, currency, 'debit');
  const credit = await ledgerRepository.insertEntry(client, {
    transferId, accountId: creditAccountId, direction: 'credit', amount, currency,
  });
  await ledgerRepository.applyBalanceChange(client, creditAccountId, amount, currency, 'credit');
  return { debit, credit };
}

function assertCanDebit(lockedAccounts, accountId, amount) {
  const account = lockedAccounts.find((a) => a.id === accountId);
  if (!account) throw httpError(422, 'ACCOUNT_MISMATCH', 'Account not found');
  if (compare(account.cached_balance, amount) < 0) throw new InsufficientFundsError();
}

async function recordTransfer(transferId, debitAccountId, creditAccountId, amount, currency) {
  if (compare(amount, '0') <= 0) throw httpError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (debitAccountId === creditAccountId) {
    throw httpError(400, 'SAME_ACCOUNT', 'Debit and credit accounts must differ');
  }

  return withTransaction(async (client) => {
    const locked = await ledgerRepository.lockAccounts(client, [debitAccountId, creditAccountId]);
    if (locked.length !== 2) throw httpError(422, 'ACCOUNT_MISMATCH', 'Account not found');
    assertCanDebit(locked, debitAccountId, amount);
    return writePair(client, { transferId, debitAccountId, creditAccountId, amount, currency });
  });
}

async function recordCrossCurrencyTransfer({
  transferId, senderAccountId, receiverAccountId, sourcePoolAccountId, destPoolAccountId,
  sourceAmount, sourceCurrency, destAmount, destCurrency, afterWrite,
}) {
  if (compare(sourceAmount, '0') <= 0 || compare(destAmount, '0') <= 0) {
    throw httpError(400, 'INVALID_AMOUNT', 'Amounts must be positive');
  }
  const ids = [senderAccountId, receiverAccountId, sourcePoolAccountId, destPoolAccountId];
  if (new Set(ids).size !== 4) throw httpError(400, 'SAME_ACCOUNT', 'All four accounts must differ');

  return withTransaction(async (client) => {
    const locked = await ledgerRepository.lockAccounts(client, ids);
    if (locked.length !== 4) throw httpError(422, 'ACCOUNT_MISMATCH', 'Account not found');
    assertCanDebit(locked, senderAccountId, sourceAmount);

    const payIn = await writePair(client, {
      transferId, debitAccountId: senderAccountId, creditAccountId: sourcePoolAccountId,
      amount: sourceAmount, currency: sourceCurrency,
    });
    const payOut = await writePair(client, {
      transferId, debitAccountId: destPoolAccountId, creditAccountId: receiverAccountId,
      amount: destAmount, currency: destCurrency,
    });
    if (afterWrite) await afterWrite(client);
    return { entries: [payIn.debit, payIn.credit, payOut.debit, payOut.credit] };
  });
}

module.exports = { recordTransfer, recordCrossCurrencyTransfer, InsufficientFundsError };