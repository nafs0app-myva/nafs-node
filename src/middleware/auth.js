const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { fail } = require('../utils/response');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'Authentication required', 401);

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return fail(res, 'Invalid or expired token', 401);
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret);
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      /* ignore */
    }
  }
  next();
}

module.exports = { authenticate, optionalAuth };
