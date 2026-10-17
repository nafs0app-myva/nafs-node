const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const env = require('../config/env');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  full_name: Joi.string().min(2).max(120).required(),
  phone: Joi.string().allow('', null),
  role: Joi.string().valid('therapist', 'client').default('therapist'),
  locale: Joi.string().valid('en', 'ar').default('en'),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(8).required(),
});

function signToken(user) {
  return jwt.sign({ email: user.email, role: user.role }, env.jwt.secret, {
    subject: String(user.id),
    expiresIn: env.jwt.expiresIn,
  });
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    role: row.role,
    locale: row.locale,
    is_verified: !!row.is_verified,
    created_at: row.created_at,
  };
}

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const register = asyncHandler(async (req, res) => {
  const payload = req.body;
  const existing = await query(`SELECT id FROM users WHERE email = :email`, { email: payload.email });
  if (existing.length) return fail(res, 'Email already registered', 409);

  const password_hash = await bcrypt.hash(payload.password, 10);
  const result = await withTransaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO users (email, phone, password_hash, full_name, role, locale)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.email,
        payload.phone || null,
        password_hash,
        payload.full_name,
        payload.role || 'therapist',
        payload.locale || 'en',
      ]
    );
    const userId = insert.insertId;
    if ((payload.role || 'therapist') === 'therapist') {
      await conn.execute(`INSERT INTO therapist_profiles (user_id) VALUES (?)`, [userId]);
      await conn.execute(`INSERT INTO therapist_applications (user_id) VALUES (?)`, [userId]);
      await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'SAR')`, [userId]);
    }
    const code = makeOtp();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await conn.execute(
      `INSERT INTO otp_codes (user_id, email, code, purpose, expires_at) VALUES (?, ?, ?, 'verify_email', ?)`,
      [userId, payload.email, code, expires]
    );
    const [users] = await conn.execute(`SELECT * FROM users WHERE id = ?`, [userId]);
    return { user: users[0], otp: code };
  });

  return ok(
    res,
    {
      user: publicUser(result.user),
      token: signToken(result.user),
      verification_otp: env.nodeEnv === 'production' ? undefined : result.otp,
    },
    'Registered successfully',
    201
  );
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const rows = await query(`SELECT * FROM users WHERE email = :email`, { email });
  if (!rows.length) return fail(res, 'Invalid email or password', 401);
  const user = rows[0];
  if (!user.is_active) return fail(res, 'Account disabled', 403);
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return fail(res, 'Invalid email or password', 401);
  return ok(res, { user: publicUser(user), token: signToken(user) }, 'Logged in');
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const rows = await query(
    `SELECT * FROM otp_codes WHERE email = :email AND purpose = 'verify_email' AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    { email }
  );
  if (!rows.length || rows[0].code !== code) return fail(res, 'Invalid OTP', 400);
  if (new Date(rows[0].expires_at) < new Date()) return fail(res, 'OTP expired', 400);
  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = :id`, { id: rows[0].id });
  await query(`UPDATE users SET is_verified = 1 WHERE email = :email`, { email });
  return ok(res, null, 'Email verified');
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const users = await query(`SELECT id, email FROM users WHERE email = :email`, { email });
  if (!users.length) return ok(res, null, 'If that email exists, an OTP was sent');
  const code = makeOtp();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await query(
    `INSERT INTO otp_codes (user_id, email, code, purpose, expires_at)
     VALUES (:user_id, :email, :code, 'reset_password', :expires_at)`,
    { user_id: users[0].id, email, code, expires_at: expires }
  );
  return ok(
    res,
    { reset_otp: env.nodeEnv === 'production' ? undefined : code },
    'If that email exists, an OTP was sent'
  );
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, password } = req.body;
  const rows = await query(
    `SELECT * FROM otp_codes WHERE email = :email AND purpose = 'reset_password' AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    { email }
  );
  if (!rows.length || rows[0].code !== code) return fail(res, 'Invalid OTP', 400);
  if (new Date(rows[0].expires_at) < new Date()) return fail(res, 'OTP expired', 400);
  const password_hash = await bcrypt.hash(password, 10);
  await query(`UPDATE users SET password_hash = :password_hash WHERE email = :email`, {
    password_hash,
    email,
  });
  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = :id`, { id: rows[0].id });
  return ok(res, null, 'Password updated');
});

const changePassword = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!rows.length) return fail(res, 'User not found', 404);
  const okPw = await bcrypt.compare(req.body.current_password, rows[0].password_hash);
  if (!okPw) return fail(res, 'Current password is incorrect', 400);
  const password_hash = await bcrypt.hash(req.body.new_password, 10);
  await query(`UPDATE users SET password_hash = :password_hash WHERE id = :id`, {
    password_hash,
    id: req.user.id,
  });
  return ok(res, null, 'Password changed');
});

const me = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!rows.length) return fail(res, 'User not found', 404);
  let application = null;
  let profile = null;
  if (rows[0].role === 'therapist') {
    const apps = await query(`SELECT * FROM therapist_applications WHERE user_id = :id`, {
      id: req.user.id,
    });
    application = apps[0] || null;
    const profiles = await query(`SELECT * FROM therapist_profiles WHERE user_id = :id`, {
      id: req.user.id,
    });
    profile = profiles[0] || null;
  }
  return ok(res, { user: publicUser(rows[0]), profile, application });
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  me,
};
