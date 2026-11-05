const bcrypt = require('bcryptjs');
const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { invalidateUser } = require('../middleware/auth');
const { normalisePhone } = require('../utils/phone');

const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).required(),
  full_name: Joi.string().min(2).max(120).required(),
  phone: Joi.string().max(32).allow('', null),
  role: Joi.string().valid('therapist', 'client', 'admin').default('client'),
  locale: Joi.string().valid('en', 'ar').default('en'),
  is_verified: Joi.boolean().default(true),
  is_active: Joi.boolean().default(true),
});

const createConsultantSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).required(),
  full_name: Joi.string().min(2).max(120).required(),
  phone: Joi.string().max(32).allow('', null),
  locale: Joi.string().valid('en', 'ar').default('en'),
  city: Joi.string().max(120).allow('', null),
  country: Joi.string().max(120).allow('', null),
  bio: Joi.string().max(2000).allow('', null),
  years_experience: Joi.number().integer().min(0).max(60).default(0),
  session_fee_default: Joi.number().min(0).allow(null),
  gender: Joi.string().valid('male', 'female', 'unspecified').default('unspecified'),
});

const updateUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().max(32).allow('', null),
  role: Joi.string().valid('therapist', 'client', 'admin'),
  locale: Joi.string().valid('en', 'ar'),
  is_verified: Joi.boolean(),
  is_active: Joi.boolean(),
  password: Joi.string().min(8).max(72),
}).min(1);

const reviewSchema = Joi.object({
  notes: Joi.string().max(2000).allow('', null),
});

function publicAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    role: row.role,
    locale: row.locale,
    is_verified: !!row.is_verified,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    application_status: row.application_status || null,
    city: row.city || null,
    session_fee_default: row.session_fee_default != null ? Number(row.session_fee_default) : null,
  };
}

const overview = asyncHandler(async (_req, res) => {
  const [totals] = await query(`
    SELECT
      SUM(role = 'client') AS clients,
      SUM(role = 'therapist') AS consultants,
      SUM(role = 'admin') AS admins,
      SUM(is_active = 1) AS active_users,
      SUM(is_active = 0) AS inactive_users,
      COUNT(*) AS users_total
    FROM users
  `);

  const [today] = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()) AS users_joined,
      (SELECT COUNT(*) FROM users WHERE role = 'therapist' AND DATE(created_at) = CURDATE()) AS consultants_joined,
      (SELECT COUNT(*) FROM users WHERE role = 'client' AND DATE(created_at) = CURDATE()) AS clients_joined,
      (SELECT COUNT(*) FROM sessions WHERE DATE(starts_at) = CURDATE()) AS sessions_today,
      (SELECT COUNT(*) FROM bookings WHERE DATE(created_at) = CURDATE()) AS bookings_today,
      (SELECT COUNT(*) FROM mood_checkins WHERE DATE(checked_in_at) = CURDATE()) AS mood_checkins_today,
      (SELECT COUNT(*) FROM journal_entries WHERE entry_date = CURDATE()) AS journal_entries_today,
      (SELECT COUNT(*) FROM therapist_applications WHERE status = 'submitted') AS applications_pending
  `);

  const recentUsers = await query(
    `SELECT id, email, full_name, role, is_active, is_verified, created_at
     FROM users ORDER BY id DESC LIMIT 8`
  );

  const pendingApps = await query(
    `SELECT a.id, a.status, a.submitted_at, u.id AS user_id, u.full_name, u.email
     FROM therapist_applications a
     JOIN users u ON u.id = a.user_id
     WHERE a.status IN ('submitted', 'under_review')
     ORDER BY a.submitted_at DESC LIMIT 10`
  );

  return ok(res, {
    totals: {
      users_total: Number(totals?.users_total || 0),
      clients: Number(totals?.clients || 0),
      consultants: Number(totals?.consultants || 0),
      admins: Number(totals?.admins || 0),
      active_users: Number(totals?.active_users || 0),
      inactive_users: Number(totals?.inactive_users || 0),
    },
    today: {
      users_joined: Number(today?.users_joined || 0),
      consultants_joined: Number(today?.consultants_joined || 0),
      clients_joined: Number(today?.clients_joined || 0),
      sessions_today: Number(today?.sessions_today || 0),
      bookings_today: Number(today?.bookings_today || 0),
      mood_checkins_today: Number(today?.mood_checkins_today || 0),
      journal_entries_today: Number(today?.journal_entries_today || 0),
      applications_pending: Number(today?.applications_pending || 0),
    },
    recent_users: recentUsers,
    pending_applications: pendingApps,
  });
});

const activity = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const span = days - 1;

  const [users, consultants, clients, sessions, bookings, moods, journals] = await Promise.all([
    query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(created_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM users WHERE role = 'therapist' AND created_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(created_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM users WHERE role = 'client' AND created_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(created_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(starts_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM sessions WHERE starts_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(starts_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM bookings WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(created_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(checked_in_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM mood_checkins WHERE checked_in_at >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY DATE(checked_in_at)`,
      { span }
    ),
    query(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM journal_entries WHERE entry_date >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
       GROUP BY entry_date`,
      { span }
    ),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.day, Number(r.c)]));
  const maps = {
    users: toMap(users),
    consultants: toMap(consultants),
    clients: toMap(clients),
    sessions: toMap(sessions),
    bookings: toMap(bookings),
    mood_checkins: toMap(moods),
    journal_entries: toMap(journals),
  };

  const series = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    series.push({
      day,
      users: maps.users[day] || 0,
      consultants: maps.consultants[day] || 0,
      clients: maps.clients[day] || 0,
      sessions: maps.sessions[day] || 0,
      bookings: maps.bookings[day] || 0,
      mood_checkins: maps.mood_checkins[day] || 0,
      journal_entries: maps.journal_entries[day] || 0,
    });
  }

  return ok(res, { days, series });
});

const listUsers = asyncHandler(async (req, res) => {
  const role = (req.query.role || '').trim();
  const q = (req.query.q || '').trim();
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const offset = (page - 1) * limit;

  const where = ['1=1'];
  const params = {};
  if (role && ['therapist', 'client', 'admin'].includes(role)) {
    where.push('u.role = :role');
    params.role = role;
  }
  if (q) {
    where.push('(u.full_name LIKE :q OR u.email LIKE :q OR u.phone LIKE :q)');
    params.q = `%${q}%`;
  }
  if (req.query.active === '1') where.push('u.is_active = 1');
  if (req.query.active === '0') where.push('u.is_active = 0');

  const sqlWhere = where.join(' AND ');
  const [countRow] = await query(`SELECT COUNT(*) AS c FROM users u WHERE ${sqlWhere}`, params);
  const rows = await query(
    `SELECT u.*, a.status AS application_status, tp.city, tp.session_fee_default
     FROM users u
     LEFT JOIN therapist_applications a ON a.user_id = u.id
     LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
     WHERE ${sqlWhere}
     ORDER BY u.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok(res, {
    users: rows.map(publicAdminUser),
    page,
    limit,
    total: Number(countRow?.c || 0),
  });
});

const createUser = asyncHandler(async (req, res) => {
  const p = req.body;
  const existing = await query(`SELECT id FROM users WHERE email = :email`, { email: p.email });
  if (existing.length) return fail(res, 'Email already registered', 409);

  let phone = null;
  if (p.phone) {
    phone = normalisePhone(p.phone) || p.phone;
    if ((await query(`SELECT id FROM users WHERE phone = :phone`, { phone })).length) {
      return fail(res, 'Phone number already registered', 409);
    }
  }

  const password_hash = await bcrypt.hash(p.password, 10);
  const role = p.role || 'client';
  const userId = await withTransaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO users (email, phone, password_hash, full_name, role, locale, is_verified, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.email,
        phone,
        password_hash,
        p.full_name,
        role,
        p.locale || 'en',
        p.is_verified === false ? 0 : 1,
        p.is_active === false ? 0 : 1,
      ]
    );
    const id = insert.insertId;
    if (role === 'therapist') {
      await conn.execute(`INSERT INTO therapist_profiles (user_id) VALUES (?)`, [id]);
      await conn.execute(
        `INSERT INTO therapist_applications (user_id, status, step, submitted_at, reviewed_at, reviewed_by)
         VALUES (?, 'approved', 'submitted', NOW(), NOW(), ?)`,
        [id, req.user.id]
      );
      await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'SAR')`, [id]);
    } else if (role === 'client') {
      await conn.execute(`INSERT INTO client_profiles (user_id, preferred_language) VALUES (?, ?)`, [
        id,
        p.locale || 'en',
      ]);
    }
    if (role === 'therapist' || role === 'client') {
      await conn.execute(`INSERT INTO user_onboarding (user_id, role, completed) VALUES (?, ?, 1)`, [
        id,
        role,
      ]);
    }
    await conn.execute(
      `INSERT INTO notification_preferences (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id`,
      [id]
    );
    return id;
  });

  const [row] = await query(`SELECT * FROM users WHERE id = :id`, { id: userId });
  return ok(res, { user: publicAdminUser(row) }, 'User created', 201);
});

const createConsultant = asyncHandler(async (req, res) => {
  const p = req.body;
  const existing = await query(`SELECT id FROM users WHERE email = :email`, { email: p.email });
  if (existing.length) return fail(res, 'Email already registered', 409);

  let phone = null;
  if (p.phone) {
    phone = normalisePhone(p.phone) || p.phone;
    if ((await query(`SELECT id FROM users WHERE phone = :phone`, { phone })).length) {
      return fail(res, 'Phone number already registered', 409);
    }
  }

  const password_hash = await bcrypt.hash(p.password, 10);
  const userId = await withTransaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO users (email, phone, password_hash, full_name, role, locale, is_verified, is_active)
       VALUES (?, ?, ?, ?, 'therapist', ?, 1, 1)`,
      [p.email, phone, password_hash, p.full_name, p.locale || 'en']
    );
    const id = insert.insertId;
    await conn.execute(
      `INSERT INTO therapist_profiles
        (user_id, gender, bio, years_experience, city, country, session_fee_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        p.gender || 'unspecified',
        p.bio || null,
        p.years_experience || 0,
        p.city || null,
        p.country || null,
        p.session_fee_default != null ? p.session_fee_default : null,
      ]
    );
    await conn.execute(
      `INSERT INTO therapist_applications
        (user_id, status, step, submitted_at, reviewed_at, reviewed_by, identity_payload, experience_payload)
       VALUES (?, 'approved', 'submitted', NOW(), NOW(), ?, ?, ?)`,
      [
        id,
        req.user.id,
        JSON.stringify({ full_name: p.full_name, phone }),
        JSON.stringify({ years_experience: p.years_experience || 0, bio: p.bio || null }),
      ]
    );
    await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'SAR')`, [id]);
    await conn.execute(
      `INSERT INTO user_onboarding (user_id, role, completed, completed_at) VALUES (?, 'therapist', 1, NOW())`,
      [id]
    );
    await conn.execute(
      `INSERT INTO notification_preferences (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id`,
      [id]
    );
    return id;
  });

  const [row] = await query(
    `SELECT u.*, a.status AS application_status, tp.city, tp.session_fee_default
     FROM users u
     LEFT JOIN therapist_applications a ON a.user_id = u.id
     LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
     WHERE u.id = :id`,
    { id: userId }
  );
  return ok(res, { consultant: publicAdminUser(row) }, 'Consultant added', 201);
});

const updateUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await query(`SELECT * FROM users WHERE id = :id`, { id });
  if (!existing) return fail(res, 'User not found', 404);

  const p = req.body;
  const fields = [];
  const params = { id };

  for (const key of ['full_name', 'role', 'locale']) {
    if (p[key] !== undefined) {
      fields.push(`${key} = :${key}`);
      params[key] = p[key];
    }
  }
  if (p.phone !== undefined) {
    fields.push('phone = :phone');
    params.phone = p.phone ? normalisePhone(p.phone) || p.phone : null;
  }
  if (p.is_verified !== undefined) {
    fields.push('is_verified = :is_verified');
    params.is_verified = p.is_verified ? 1 : 0;
  }
  if (p.is_active !== undefined) {
    fields.push('is_active = :is_active');
    params.is_active = p.is_active ? 1 : 0;
  }
  if (p.password) {
    fields.push('password_hash = :password_hash');
    fields.push('password_changed_at = NOW()');
    params.password_hash = await bcrypt.hash(p.password, 10);
  }
  if (!fields.length) return fail(res, 'No changes', 400);

  // Don't let the last active admin deactivate themselves into a lockout.
  if (
    Number(req.user.id) === id &&
    ((p.is_active === false) || (p.role && p.role !== 'admin'))
  ) {
    return fail(res, 'You cannot deactivate or demote your own admin account', 400);
  }

  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = :id`, params);
  invalidateUser(id);

  const [row] = await query(
    `SELECT u.*, a.status AS application_status, tp.city, tp.session_fee_default
     FROM users u
     LEFT JOIN therapist_applications a ON a.user_id = u.id
     LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
     WHERE u.id = :id`,
    { id }
  );
  return ok(res, { user: publicAdminUser(row) }, 'User updated');
});

const removeUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await query(`SELECT id, role, email FROM users WHERE id = :id`, { id });
  if (!existing) return fail(res, 'User not found', 404);
  if (Number(req.user.id) === id) return fail(res, 'You cannot remove your own account', 400);

  const hard = String(req.query.hard || '').toLowerCase() === '1' || req.query.hard === 'true';
  if (hard) {
    await query(`DELETE FROM users WHERE id = :id`, { id });
    invalidateUser(id);
    return ok(res, { id, deleted: true }, 'User permanently deleted');
  }

  await query(`UPDATE users SET is_active = 0 WHERE id = :id`, { id });
  invalidateUser(id);
  return ok(res, { id, deactivated: true }, 'User deactivated');
});

const listApplications = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT a.id, a.status, a.step, a.submitted_at, a.reviewed_at, a.review_notes,
            u.id AS user_id, u.full_name, u.email, u.phone, u.is_active,
            tp.city, tp.years_experience, tp.session_fee_default
     FROM therapist_applications a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
     ORDER BY
       FIELD(a.status, 'submitted', 'under_review', 'draft', 'approved', 'rejected'),
       a.submitted_at DESC,
       a.id DESC
     LIMIT 200`
  );
  return ok(res, { applications: rows });
});

const approveApplication = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [app] = await query(`SELECT * FROM therapist_applications WHERE id = :id`, { id });
  if (!app) return fail(res, 'Application not found', 404);

  await query(
    `UPDATE therapist_applications
     SET status = 'approved', step = 'submitted', reviewed_at = NOW(), reviewed_by = :uid,
         review_notes = :notes
     WHERE id = :id`,
    { id, uid: req.user.id, notes: req.body.notes || null }
  );
  await query(`UPDATE users SET is_verified = 1, is_active = 1, role = 'therapist' WHERE id = :uid`, {
    uid: app.user_id,
  });
  const [row] = await query(`SELECT * FROM therapist_applications WHERE id = :id`, { id });
  return ok(res, { application: row }, 'Application approved');
});

const rejectApplication = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [app] = await query(`SELECT * FROM therapist_applications WHERE id = :id`, { id });
  if (!app) return fail(res, 'Application not found', 404);

  await query(
    `UPDATE therapist_applications
     SET status = 'rejected', reviewed_at = NOW(), reviewed_by = :uid, review_notes = :notes
     WHERE id = :id`,
    { id, uid: req.user.id, notes: req.body.notes || null }
  );
  const [row] = await query(`SELECT * FROM therapist_applications WHERE id = :id`, { id });
  return ok(res, { application: row }, 'Application rejected');
});

module.exports = {
  createUserSchema,
  createConsultantSchema,
  updateUserSchema,
  reviewSchema,
  overview,
  activity,
  listUsers,
  createUser,
  createConsultant,
  updateUser,
  removeUser,
  listApplications,
  approveApplication,
  rejectApplication,
};
