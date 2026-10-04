const accountService = require('./account.service');

exports.create = async (req, res, next) => {
  try {
    const currency = String((req.body || {}).currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      const e = new Error('currency must be a 3-letter code, e.g. NGN');
      e.status = 400;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    const account = await accountService.createAccount(req.user.id, currency);
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    res.json(await accountService.getAccountForUser(req.params.id, req.user.id));
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    res.json(await accountService.listAccountsForUser(req.user.id));
  } catch (err) {
    next(err);
  }
};