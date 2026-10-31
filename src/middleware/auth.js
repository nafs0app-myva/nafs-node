const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { fail } = require('../utils/response');
const crypto = require('crypto');
const { query } = require('../config/db');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Validity checks (deactivated? password changed? revoked?) are cached for a few
// seconds per token so a busy session doesn't hit the database on every request.
// Logging out or changing the password clears the user's entries immediately.
const CACHE_MS = 15 * 1000;
const validCache = new Map(); // `${userId}:${tokenHash}` -> expiry timestamp
function invalidateUser(userId) {
  const prefix = `${userId}:`;
  for (const key of validCache.keys()) if (key.startsWith(prefix)) validCache.delete(key);
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'Authentication required', 401);

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch {
    return fail(res, 'Invalid or expired token', 401);
  }
  // A token issued before the last password change (or for a deactivated
  // account) is no longer valid, so changing the password signs out other devices.
  const cacheKey = `${payload.sub}:${hashToken(token)}`;
  if ((validCache.get(cacheKey) || 0) > Date.now()) {
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  }
  const [row] = await query(
    `SELECT is_active, UNIX_TIMESTAMP(password_changed_at) AS changed FROM users WHERE id = :id`,
    { id: payload.sub }
  );
  if (!row || row.is_active === 0) return fail(res, 'Invalid or expired token', 401);
  // A token that was explicitly signed out (POST /auth/logout) stays dead until it would have expired anyway.
  const [revoked] = await query(`SELECT 1 AS x FROM revoked_tokens WHERE token_hash = :h`, { h: hashToken(token) });
  if (revoked) return fail(res, 'Session ended. Please sign in again.', 401);
  if (row.changed && payload.iat < Number(row.changed)) return fail(res, 'Session expired. Please sign in again.', 401);
  validCache.set(cacheKey, Date.now() + CACHE_MS);
  if (validCache.size > 5000) validCache.clear();
  req.user = { id: payload.sub, email: payload.email, role: payload.role };
  return next();
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      /* ignore */
    }
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return fail(res, 'Forbidden', 403);
    }
    return next();
  };
}

module.exports = { authenticate, optionalAuth, requireRole, hashToken, invalidateUser };
