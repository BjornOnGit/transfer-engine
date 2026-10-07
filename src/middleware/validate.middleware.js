module.exports = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const err = new Error('Request validation failed');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(err);
  }
  req.body = result.data; // trimmed / normalized values replace the raw body
  next();
};