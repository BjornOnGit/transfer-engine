const authService = require('./auth.service');

exports.signup = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!name || !email || !password) {
      const e = new Error('name, email and password are required');
      e.status = 400;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    const user = await authService.signup({ name, email, phone, password });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      const e = new Error('email and password are required');
      e.status = 400;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    res.json(await authService.login({ email, password }));
  } catch (err) {
    next(err);
  }
};