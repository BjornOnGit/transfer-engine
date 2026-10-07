const transferRepository = require('./transfer.repository');
const fxService = require('../fx/fx.service');
const fxRepository = require('../fx/fx.repository');
const ledgerService = require('../ledger/ledger.service');
const { canTransition } = require('./transfer.state-machine');
const { compare, multiply, format } = require('../../lib/money');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

async function moveTo(transferId, from, to, options) {
  if (!canTransition(from, to)) {
    throw httpError(500, 'INVALID_TRANSITION', `Illegal transition ${from} -> ${to}`);
  }
  const row = await transferRepository.transition(transferId, from, to, options);
  if (!row) throw httpError(409, 'INVALID_STATE', `Transfer is not in state ${from}`);
}

function present(row) {
  return {
    id: row.id,
    sender_account_id: row.sender_account_id,
    receiver_account_id: row.receiver_account_id,
    source_currency: row.source_currency,
    dest_currency: row.dest_currency,
    amount: row.amount,
    dest_amount: row.rate ? format(multiply(row.amount, row.rate), 2) : null,
    status: row.status,
    locked_rate: row.lock_id
      ? { id: row.lock_id, rate: row.rate, locked_at: row.locked_at, expires_at: row.expires_at }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createTransfer({ userId, senderAccountId, receiverAccountId, amount }) {
  if (![senderAccountId, receiverAccountId].every((id) => UUID_RE.test(id))) {
    throw httpError(400, 'VALIDATION_ERROR', 'senderAccountId and receiverAccountId must be valid ids');
  }
  if (!AMOUNT_RE.test(amount) || compare(amount, '0') <= 0) {
    throw httpError(400, 'VALIDATION_ERROR', 'amount must be a positive number with at most 2 decimals');
  }

  const sender = await transferRepository.findAccount(senderAccountId);
  const receiver = await transferRepository.findAccount(receiverAccountId);
  if (!sender || !receiver) throw httpError(404, 'NOT_FOUND', 'Account not found');
  if (sender.user_id !== userId) throw httpError(403, 'FORBIDDEN', 'Not your account');
  if (sender.currency === receiver.currency) {
    throw httpError(400, 'SAME_CURRENCY', 'Transfers must be between accounts of different currencies');
  }

  // fail fast, before any row is written
  const pair = `${sender.currency}_${receiver.currency}`;
  await fxService.getRate(pair);
  const sourcePoolAccountId = await fxRepository.getFxPoolAccountId(sender.currency);
  const destPoolAccountId = await fxRepository.getFxPoolAccountId(receiver.currency);

  const transfer = await transferRepository.insertTransfer({
    senderAccountId, receiverAccountId,
    sourceCurrency: sender.currency, destCurrency: receiver.currency, amount,
  });

  const lock = await fxService.lockRate(transfer.id, pair);
  await moveTo(transfer.id, 'initiated', 'rate_locked', { lockedRateId: lock.id });

  await ledgerService.recordCrossCurrencyTransfer({
    transferId: transfer.id,
    senderAccountId, receiverAccountId, sourcePoolAccountId, destPoolAccountId,
    sourceAmount: amount, sourceCurrency: sender.currency,
    destAmount: format(multiply(amount, lock.rate), 2), destCurrency: receiver.currency,
    afterWrite: (client) => moveTo(transfer.id, 'rate_locked', 'funds_moved', { db: client }),
  });

  await moveTo(transfer.id, 'funds_moved', 'completed');
  return present(await transferRepository.getTransferWithLock(transfer.id));
}

async function getTransferForUser(transferId, userId) {
  if (!UUID_RE.test(transferId)) throw httpError(404, 'NOT_FOUND', 'Transfer not found');
  const row = await transferRepository.getTransferWithLock(transferId);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Transfer not found');
  if (userId !== row.sender_user_id && userId !== row.receiver_user_id) {
    throw httpError(403, 'FORBIDDEN', 'Not your transfer');
  }
  return present(row);
}

module.exports = { createTransfer, getTransferForUser, present };