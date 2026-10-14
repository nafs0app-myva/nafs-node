const { fail } = require('../utils/response');

function notFound(req, res) {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

function errorHandler(err, _req, res, _next) {
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') {
    return fail(res, 'Duplicate entry', 409);
  }
  const status = err.status || 500;
  return fail(res, err.message || 'Internal server error', status);
}

module.exports = { notFound, errorHandler };
