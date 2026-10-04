const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

const unauthorized = () => {
  const e = new Error('Authentication required');
  e.status = 401;
  e.code = 'UNAUTHORIZED';
  return e;
};

module.exports = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    next(unauthorized());
  }
};