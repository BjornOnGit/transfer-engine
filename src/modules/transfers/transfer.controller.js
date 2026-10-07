const transferService = require('./transfer.service');

exports.create = async (req, res, next) => {
  try {
    const { senderAccountId, receiverAccountId, amount } = req.body || {};
    if (!senderAccountId || !receiverAccountId || amount === undefined) {
      const e = new Error('senderAccountId, receiverAccountId and amount are required');
      e.status = 400;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    const transfer = await transferService.createTransfer({
      userId: req.user.id, senderAccountId, receiverAccountId, amount: String(amount),
    });
    res.status(201).json(transfer);
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    res.json(await transferService.getTransferForUser(req.params.id, req.user.id));
  } catch (err) {
    next(err);
  }
};