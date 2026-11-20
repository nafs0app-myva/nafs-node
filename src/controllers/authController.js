const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const env = require('../config/env');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { sendOtpEmail, sendMail } = require('../services/emailService');
const { notify } = require('../utils/notify');
const { maskIban } = require('../utils/iban');
const { hashToken, invalidateUser } = require('../middleware/auth');
const { normalisePhone, nationalDigits } = require('../utils/phone');
const firebaseAuth = require('../services/firebaseAuth');

// A valid bcrypt hash of a random string, compared against when the account doesn't exist.
const DUMMY_HASH = bcrypt.hashSync('nafs-dummy-password', 10);

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  full_name: Joi.string().min(2).max(120).required(),
  phone: Joi.string().max(32).allow('', null),
  // Dial code the phone was typed with (e.g. +966); the number is stored as E.164.
  phone_country: Joi.string().pattern(/^\+\d{1,4}$/).allow('', null),
  role: Joi.string().valid('therapist', 'client').default('therapist'),
  locale: Joi.string().valid('en', 'ar').default('en'),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().email(),
  phone: Joi.string().max(32),
  phone_country: Joi.string().pattern(/^\+\d{1,4}$/).allow('', null),
  password: Joi.string().max(200).required(),
}).xor('email', 'phone');

// 8-72 characters (bcrypt ignores anything past 72) with upper, lower, a digit and a special character.
const strongPassword = Joi.string()
  .min(8)
  .max(72)
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/\d/, 'number')
  .pattern(/[^A-Za-z0-9]/, 'special character')
  .messages({
    'string.pattern.name': 'Password must include an uppercase letter, a lowercase letter, a number and a special character',
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password must be 72 characters or fewer',
  });

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: strongPassword.required(),
});

const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required(),
});

const socialLoginSchema = Joi.object({
  provider: Joi.string().valid('google', 'apple').required(),
  id_token: Joi.string().min(20).required(),
  role: Joi.string().valid('client', 'therapist').required(),
  full_name: Joi.string().trim().min(1).max(120).allow('', null),
  locale: Joi.string().valid('en', 'ar').default('en'),
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

function parseJsonField(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function shapeClientProfile(row) {
  if (!row) return null;
  return {
    ...row,
    concerns: parseJsonField(row.concerns),
    onboarding_completed: !!row.onboarding_completed,
  };
}

const register = asyncHandler(async (req, res) => {
  const payload = req.body;
  const role = payload.role || 'therapist';
  const existing = await query(`SELECT id FROM users WHERE email = :email`, { email: payload.email });
  if (existing.length) return fail(res, 'Email already registered', 409);
  const phone = payload.phone ? normalisePhone(payload.phone, payload.phone_country) : null;
  if (payload.phone && !phone) return fail(res, 'Enter a valid phone number', 422);
  if (phone && (await query(`SELECT id FROM users WHERE phone = :phone`, { phone })).length) {
    return fail(res, 'Phone number already registered', 409);
  }

  const password_hash = await bcrypt.hash(payload.password, 10);
  const result = await withTransaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO users (email, phone, password_hash, full_name, role, locale)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.email,
        phone,
        password_hash,
        payload.full_name,
        role,
        payload.locale || 'en',
      ]
    );
    const userId = insert.insertId;
    if (role === 'therapist') {
      await conn.execute(`INSERT INTO therapist_profiles (user_id) VALUES (?)`, [userId]);
      await conn.execute(`INSERT INTO therapist_applications (user_id) VALUES (?)`, [userId]);
      await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'SAR')`, [
        userId,
      ]);
    } else {
      await conn.execute(
        `INSERT INTO client_profiles (user_id, preferred_language) VALUES (?, ?)`,
        [userId, payload.locale || 'en']
      );
    }
    await conn.execute(`INSERT INTO user_onboarding (user_id, role) VALUES (?, ?)`, [userId, role]);
    await conn.execute(
      `INSERT INTO notification_preferences (user_id) VALUES (?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [userId]
    );

    const code = makeOtp();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await conn.execute(
      `INSERT INTO otp_codes (user_id, email, code, purpose, expires_at) VALUES (?, ?, ?, 'verify_email', ?)`,
      [userId, payload.email, code, expires]
    );
    const [users] = await conn.execute(`SELECT * FROM users WHERE id = ?`, [userId]);
    return { user: users[0], otp: code };
  });

  const emailResult = await sendOtpEmail({
    email: payload.email,
    code: result.otp,
    purpose: 'verify_email',
  });

  const delivery = {
    delivered: !!emailResult.delivered,
    mode: emailResult.mode,
    message: emailResult.message || null,
  };

  return ok(
    res,
    {
      user: publicUser(result.user),
      token: signToken(result.user),
      email_delivery: delivery,
      // Dev/local convenience only — never expose OTP in production responses.
      verification_otp: env.nodeEnv === 'production' ? undefined : result.otp,
    },
    delivery.delivered
      ? 'Registered successfully. Verification code sent to email.'
      : 'Registered successfully. Verification code was generated but email was not delivered — check SMTP config.',
    201
  );
});

const login = asyncHandler(async (req, res) => {
  const { email, phone, phone_country: dial, password } = req.body;
  let user = null;
  if (email) {
    [user] = await query(`SELECT * FROM users WHERE email = :email`, { email });
  } else {
    const e164 = normalisePhone(phone, dial);
    if (e164) {
      [user] = await query(`SELECT * FROM users WHERE phone = :phone`, { phone: e164 });
      if (!user) {
        // Older accounts stored the number as typed (no country code): match on the
        // national digits, but only when exactly one account fits.
        const national = nationalDigits(phone);
        if (national.length >= 8) {
          const candidates = await query(
            `SELECT * FROM users WHERE phone IS NOT NULL
               AND REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE :tail LIMIT 2`,
            { tail: `%${national}` }
          );
          if (candidates.length === 1) user = candidates[0];
        }
      }
    }
  }
  // Always run a bcrypt compare, so an unknown account takes as long as a wrong password.
  // Social-only accounts have a null password_hash — treat them like a wrong password.
  const match = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !match) {
    return fail(res, email ? 'Invalid email or password' : 'Invalid phone number or password', 401);
  }
  if (!user.is_active) return fail(res, 'Account disabled', 403);
  return ok(res, { user: publicUser(user), token: signToken(user) }, 'Logged in');
});

async function linkSocialIdentity(conn, { userId, provider, providerUid, email }) {
  await conn.execute(
    `INSERT INTO social_identities (user_id, provider, provider_uid, email)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email)`,
    [userId, provider, providerUid, email]
  );
}

async function createSocialUser(conn, { email, fullName, avatarUrl, role, locale }) {
  const [insert] = await conn.execute(
    `INSERT INTO users (email, phone, password_hash, full_name, avatar_url, role, locale, is_verified, is_active)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, 1, 1)`,
    [email, fullName, avatarUrl || null, role, locale]
  );
  const userId = insert.insertId;
  if (role === 'therapist') {
    await conn.execute(`INSERT INTO therapist_profiles (user_id) VALUES (?)`, [userId]);
    await conn.execute(`INSERT INTO therapist_applications (user_id) VALUES (?)`, [userId]);
    await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'SAR')`, [userId]);
  } else {
    await conn.execute(`INSERT INTO client_profiles (user_id, preferred_language) VALUES (?, ?)`, [
      userId,
      locale,
    ]);
  }
  await conn.execute(`INSERT INTO user_onboarding (user_id, role) VALUES (?, ?)`, [userId, role]);
  await conn.execute(
    `INSERT INTO notification_preferences (user_id) VALUES (?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId]
  );
  const [users] = await conn.execute(`SELECT * FROM users WHERE id = ?`, [userId]);
  return users[0];
}

/**
 * POST /auth/social — exchange a Firebase ID token (Google/Apple) for a NAFS JWT.
 */
const socialLogin = asyncHandler(async (req, res) => {
  const { provider: requestedProvider, id_token: idToken, role, full_name: bodyName, locale } =
    req.body;

  let verified;
  try {
    verified = await firebaseAuth.verifyIdToken(idToken);
  } catch (err) {
    if (err.status === 503) return fail(res, err.message, 503);
    return fail(res, 'Invalid or expired token', 401);
  }

  const mapped = firebaseAuth.mapProvider(verified.signInProvider);
  const provider = mapped || requestedProvider;
  if (!['google', 'apple'].includes(provider)) {
    return fail(res, 'Unsupported sign-in provider', 400);
  }
  // Prefer the verified token's provider; reject when both are present and disagree.
  if (mapped && mapped !== requestedProvider) {
    return fail(res, 'Provider mismatch', 400);
  }

  if (!verified.email) {
    return fail(res, 'Email not available from provider', 400);
  }
  const email = String(verified.email).trim().toLowerCase();
  const providerUid = verified.uid;
  const tokenName = (verified.name || '').trim();
  const fullName =
    tokenName ||
    (bodyName && String(bodyName).trim()) ||
    email.split('@')[0] ||
    'Nafs User';
  const avatarUrl = verified.picture || null;
  const userLocale = locale || 'en';

  // 1) Existing linked identity
  const linked = await query(
    `SELECT u.* FROM social_identities si
     INNER JOIN users u ON u.id = si.user_id
     WHERE si.provider = :provider AND si.provider_uid = :provider_uid
     LIMIT 1`,
    { provider, provider_uid: providerUid }
  );
  if (linked.length) {
    const user = linked[0];
    if (!user.is_active) return fail(res, 'Account is deactivated', 403);
    return ok(
      res,
      { token: signToken(user), is_new_user: false, user: publicUser(user) },
      'Signed in'
    );
  }

  // 2) Match by email → link (only when provider email is verified)
  const byEmail = await query(`SELECT * FROM users WHERE email = :email LIMIT 1`, { email });
  if (byEmail.length) {
    if (!verified.emailVerified) {
      return fail(res, 'Email already registered. Sign in with your password.', 409);
    }
    const user = byEmail[0];
    if (!user.is_active) return fail(res, 'Account is deactivated', 403);
    await withTransaction(async (conn) => {
      await linkSocialIdentity(conn, {
        userId: user.id,
        provider,
        providerUid,
        email,
      });
    });
    // Do not change role / profile for an existing account.
    return ok(
      res,
      { token: signToken(user), is_new_user: false, user: publicUser(user) },
      'Signed in'
    );
  }

  // 3) Create new user + role rows (same shape as /auth/register)
  const created = await withTransaction(async (conn) => {
    const user = await createSocialUser(conn, {
      email,
      fullName,
      avatarUrl,
      role,
      locale: userLocale,
    });
    await linkSocialIdentity(conn, {
      userId: user.id,
      provider,
      providerUid,
      email,
    });
    return user;
  });

  return ok(
    res,
    { token: signToken(created), is_new_user: true, user: publicUser(created) },
    'Signed in',
    201
  );
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

const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const users = await query(`SELECT id, email, is_verified FROM users WHERE email = :email`, { email });
  if (!users.length) {
    return ok(res, null, 'If that email exists, a verification code was sent');
  }
  if (users[0].is_verified) return ok(res, { already_verified: true }, 'Email already verified');

  const code = makeOtp();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await query(
    `INSERT INTO otp_codes (user_id, email, code, purpose, expires_at)
     VALUES (:user_id, :email, :code, 'verify_email', :expires_at)`,
    { user_id: users[0].id, email, code, expires_at: expires }
  );
  const emailResult = await sendOtpEmail({ email, code, purpose: 'verify_email' });
  const delivery = {
    delivered: !!emailResult.delivered,
    mode: emailResult.mode,
    message: emailResult.message || null,
  };
  return ok(
    res,
    {
      email_delivery: delivery,
      verification_otp: env.nodeEnv === 'production' ? undefined : code,
    },
    delivery.delivered
      ? 'If that email exists, a verification code was sent'
      : 'Account found but verification email was not delivered — SMTP is missing or failing'
  );
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const users = await query(`SELECT id, email FROM users WHERE email = :email`, { email });
  // Same outer message for unknown emails (anti-enumeration). data:null = not found.
  if (!users.length) return ok(res, null, 'If that email exists, an OTP was sent');
  const code = makeOtp();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await query(
    `INSERT INTO otp_codes (user_id, email, code, purpose, expires_at)
     VALUES (:user_id, :email, :code, 'reset_password', :expires_at)`,
    { user_id: users[0].id, email, code, expires_at: expires }
  );
  const emailResult = await sendOtpEmail({ email, code, purpose: 'reset_password' });
  const delivery = {
    delivered: !!emailResult.delivered,
    mode: emailResult.mode,
    message: emailResult.message || null,
  };
  return ok(
    res,
    {
      email_delivery: delivery,
      reset_otp: env.nodeEnv === 'production' ? undefined : code,
    },
    delivery.delivered
      ? 'If that email exists, an OTP was sent'
      : 'Account found but OTP email was not delivered — SMTP is missing or failing on the server'
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
  await query(`UPDATE users SET password_hash = :password_hash, password_changed_at = NOW() WHERE email = :email`, {
    password_hash,
    email,
  });
  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = :id`, { id: rows[0].id });
  return ok(res, null, 'Password updated');
});

const changePassword = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!rows.length) return fail(res, 'User not found', 404);
  if (!rows[0].password_hash) {
    return fail(res, 'No password set. Use forgot password to create one.', 400);
  }
  const okPw = await bcrypt.compare(req.body.current_password, rows[0].password_hash);
  if (!okPw) return fail(res, 'Current password is incorrect', 400);
  if (req.body.new_password === req.body.current_password) {
    return fail(res, 'Choose a new password that is different from your current one', 400);
  }
  const password_hash = await bcrypt.hash(req.body.new_password, 10);
  await query(`UPDATE users SET password_hash = :password_hash, password_changed_at = NOW() WHERE id = :id`, {
    password_hash,
    id: req.user.id,
  });
  invalidateUser(req.user.id);
  // Tell the owner (an unexpected change is the first sign of a stolen account).
  await notify(req.user.id, {
    title: 'Your password was changed',
    body: 'If this was not you, reset your password immediately and contact support.',
    type: 'security',
  });
  sendMail({
    to: rows[0].email,
    subject: 'Your Nafs password was changed',
    text: 'Your Nafs password was just changed. If this was not you, reset your password immediately and contact support.',
    purpose: 'password_changed',
  }).catch(() => {});
  // Other devices are signed out (older tokens are rejected); hand this one a fresh token.
  return ok(res, { token: signToken(rows[0]) }, 'Password changed');
});

const logoutSchema = Joi.object({
  // This device's push token; it is unregistered so a signed-out account stops getting pushes here.
  fcm_token: Joi.string().max(512).allow('', null),
});

// POST /auth/logout - ends this session on the server: the token is revoked and
// this device stops receiving the account's push notifications.
const logout = asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  const payload = jwt.decode(token);
  const expires = payload?.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 7 * 86400000);
  await query(`INSERT IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (:h, :e)`, { h: hashToken(token), e: expires });
  await query(`DELETE FROM revoked_tokens WHERE expires_at < UTC_TIMESTAMP()`); // keep the table small
  invalidateUser(req.user.id);
  if (req.body.fcm_token) {
    await query(`DELETE FROM device_tokens WHERE user_id = :uid AND token = :t`, { uid: req.user.id, t: req.body.fcm_token });
  }
  return ok(res, null, 'Signed out');
});

// POST /auth/logout-all - signs the account out everywhere: every token issued so
// far stops working and all registered devices are unregistered.
const logoutAll = asyncHandler(async (req, res) => {
  await query(`UPDATE users SET password_changed_at = NOW() WHERE id = :id`, { id: req.user.id });
  await query(`DELETE FROM device_tokens WHERE user_id = :id`, { id: req.user.id });
  invalidateUser(req.user.id);
  return ok(res, null, 'Signed out of all devices');
});

const me = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!rows.length) return fail(res, 'User not found', 404);
  const user = rows[0];
  let application = null;
  let profile = null;
  let onboarding = null;

  const onboardingRows = await query(`SELECT * FROM user_onboarding WHERE user_id = :id`, {
    id: req.user.id,
  });
  if (onboardingRows[0]) {
    onboarding = {
      ...onboardingRows[0],
      payload: parseJsonField(onboardingRows[0].payload),
      completed: !!onboardingRows[0].completed,
    };
  }

  if (user.role === 'therapist') {
    const apps = await query(`SELECT * FROM therapist_applications WHERE user_id = :id`, {
      id: req.user.id,
    });
    application = apps[0] || null;
    const profiles = await query(`SELECT * FROM therapist_profiles WHERE user_id = :id`, {
      id: req.user.id,
    });
    profile = profiles[0]
      ? {
          ...profiles[0],
          practice_scope: parseJsonField(profiles[0].practice_scope),
          frameworks: parseJsonField(profiles[0].frameworks),
          // The full IBAN stays on the server; the app gets a masked copy.
          iban: undefined,
          iban_masked: maskIban(profiles[0].iban),
        }
      : null;
  } else if (user.role === 'client') {
    const profiles = await query(`SELECT * FROM client_profiles WHERE user_id = :id`, {
      id: req.user.id,
    });
    profile = shapeClientProfile(profiles[0] || null);
  }

  return ok(res, { user: publicUser(user), profile, application, onboarding });
});

module.exports = {
  logoutSchema,
  logout,
  logoutAll,
  strongPassword,
  registerSchema,
  loginSchema,
  socialLoginSchema,
  changePasswordSchema,
  resendVerificationSchema,
  register,
  login,
  socialLogin,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  me,
};
