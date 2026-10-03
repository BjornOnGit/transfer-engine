// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  const status = err.status || 500;

  if (status >= 500) console.error(err);

  res.status(status).json({
    error: {
      code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
      message: status >= 500 ? 'Internal server error' : err.message,
    },
  });
};