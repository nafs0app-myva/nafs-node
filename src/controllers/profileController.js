const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const multer = require('multer');
const env = require('../config/env');
const { AGE_GROUP_IDS, FORMAT_IDS } = require('../config/practiceScope');
const { hasChildCertification, enforceChildCertification } = require('../utils/scope');
const { MIN_SESSION_FEE, MAX_SESSION_FEE } = require('../config/fees');
const { normaliseIban, isValidIban, maskIban } = require('../utils/iban');

const updateSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  locale: Joi.string().valid('en', 'ar'),
  // Shared profile-ish
  gender: Joi.string().valid('male', 'female', 'unspecified'),
  date_of_birth: Joi.date().iso().allow(null),
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  timezone: Joi.string().custom((value, helpers) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'IANA timezone').messages({ 'any.invalid': 'Unknown timezone' }),
  // Therapist: where payouts are sent
  bank_name: Joi.string().trim().max(120).allow('', null),
  bank_account_holder: Joi.string().trim().max(120).allow('', null),
  iban: Joi.string().custom((value, helpers) => (isValidIban(value) ? normaliseIban(value) : helpers.error('any.invalid')), 'IBAN')
    .messages({ 'any.invalid': 'Enter a valid IBAN' }).allow('', null),
  // Therapist: how long one session lasts (drives bookable slots and session end times)
  session_duration_minutes: Joi.number().valid(30, 45, 50, 60, 75, 90),
  // Therapist
  // Same limits as the Bio screen (about 1000, headline 80, up to 12 methods).
  bio: Joi.string().max(1000).allow('', null),
  headline: Joi.string().max(80).allow('', null),
  frameworks: Joi.array().items(Joi.string().trim().max(40)).max(12),
  // Therapist: default session fee (applies to sessions booked after the change)
  session_fee_default: Joi.number().min(MIN_SESSION_FEE).max(MAX_SESSION_FEE),
  // Therapist: replaces the whole focus-area list when provided
  specialization_ids: Joi.array().items(Joi.number().integer()).min(1),
  native_language: Joi.string().max(40),
  languages: Joi.array().items(Joi.string().max(40)).max(4),
  address: Joi.string().allow('', null),
  video_meeting_url: Joi.string().uri().allow('', null),
  working_capacity: Joi.string().valid('individual', 'team'),
  years_experience: Joi.number().integer().min(0),
  // Therapist: replaces the whole list when provided
  licenses: Joi.array().items(
    Joi.object({
      id: Joi.number().integer(),
      license_number: Joi.string().required(),
      expiry_date: Joi.date().iso().allow(null),
      issuer: Joi.string().allow('', null),
    })
  ),
  degrees: Joi.array().items(
    Joi.object({
      id: Joi.number().integer(),
      degree_title: Joi.string().required(),
      institution: Joi.string().required(),
      year_awarded: Joi.number().integer().allow(null),
      certifies_age_group: Joi.string().valid('children').allow(null, ''),
    })
  ),
  // Therapist: age groups / session formats / modalities (free-form lists of keys)
  practice_scope: Joi.object({
    age_groups: Joi.array().items(Joi.string().valid(...AGE_GROUP_IDS)).default([]),
    formats: Joi.array().items(Joi.string().valid(...FORMAT_IDS)).default([]),
    modalities: Joi.array().items(Joi.string()).default([]),
  }),
  // Client
  about: Joi.string().allow('', null),
  preferred_therapist_gender: Joi.string().valid('male', 'female', 'any'),
  concerns: Joi.array().items(Joi.string()),
  emergency_contact_name: Joi.string().allow('', null),
  emergency_contact_phone: Joi.string().allow('', null),
}).min(1);

function parseJsonField(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Phone numbers, emails and links don't belong in a public bio: clients should
// book through Nafs, not take the conversation off-platform.
const CONTACT_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/i,
  /(https?:\/\/|www\.)/i,
  /\b[\w-]+\.(com|net|org|io|me|app|co|sa|ae)\b/i,
  /\+?\d[\d\s\-().]{7,}\d/,
];
const hasContactDetails = (text) => typeof text === 'string' && CONTACT_PATTERNS.some((re) => re.test(text));

async function loadTherapistProfile(userId, user) {
  const profiles = await query(`SELECT * FROM therapist_profiles WHERE user_id = :id`, {
    id: userId,
  });
  const specs = await query(
    `SELECT s.id, s.slug, s.name_en, s.name_ar
     FROM therapist_specializations ts
     JOIN specializations s ON s.id = ts.specialization_id
     WHERE ts.therapist_id = :id`,
    { id: userId }
  );
  const licenses = await query(`SELECT * FROM therapist_licenses WHERE therapist_id = :id`, {
    id: userId,
  });
  const degrees = await query(`SELECT * FROM therapist_degrees WHERE therapist_id = :id`, {
    id: userId,
  });
  const [rating] = await query(
    `SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS review_count FROM session_reviews WHERE therapist_id = :id`,
    { id: userId }
  );
  const profile = profiles[0]
    ? {
        ...profiles[0],
        rating: rating.review_count > 0 ? Number(rating.rating) : null,
        review_count: Number(rating.review_count),
        // The full IBAN never leaves the server; clients get a masked version.
        iban: undefined,
        iban_masked: maskIban(profiles[0].iban),
        practice_scope: parseJsonField(profiles[0].practice_scope),
        frameworks: parseJsonField(profiles[0].frameworks),
        languages: parseJsonField(profiles[0].languages) || [],
      }
    : null;
  if (profile) {
    // `methods` = catalogue modalities (by name) + the therapist's own extra methods,
    // so the Bio and Specializations screens show one consistent list.
    const scope = profile.practice_scope && typeof profile.practice_scope === 'object' ? profile.practice_scope : {};
    const slugs = Array.isArray(scope.modalities) ? scope.modalities : [];
    const names = slugs.length
      ? await query(
          `SELECT name_en FROM modalities WHERE slug IN (${slugs.map((_, i) => `:m${i}`).join(',')}) ORDER BY sort_order`,
          Object.fromEntries(slugs.map((s, i) => [`m${i}`, s]))
        )
      : [];
    const custom = Array.isArray(profile.frameworks) ? profile.frameworks : [];
    profile.methods = [...names.map((n) => n.name_en), ...custom];
  }
  return {
    user,
    role: 'therapist',
    profile,
    specializations: specs,
    licenses,
    degrees,
  };
}

async function loadClientProfile(userId, user) {
  let profiles = await query(`SELECT * FROM client_profiles WHERE user_id = :id`, { id: userId });
  if (!profiles.length) {
    await query(
      `INSERT INTO client_profiles (user_id, preferred_language) VALUES (:id, :locale)`,
      { id: userId, locale: user.locale || 'en' }
    );
    profiles = await query(`SELECT * FROM client_profiles WHERE user_id = :id`, { id: userId });
  }
  const goalRows = await query(`SELECT goals FROM user_goals WHERE user_id = :id`, { id: userId });
  const profile = profiles[0]
    ? {
        ...profiles[0],
        concerns: parseJsonField(profiles[0].concerns),
        onboarding_completed: !!profiles[0].onboarding_completed,
      }
    : null;
  return {
    user,
    role: 'client',
    profile,
    goals: goalRows[0] ? parseJsonField(goalRows[0].goals) : [],
  };
}

const getProfile = asyncHandler(async (req, res) => {
  const users = await query(
    `SELECT id, email, phone, full_name, avatar_url, role, locale, is_verified, created_at
     FROM users WHERE id = :id`,
    { id: req.user.id }
  );
  if (!users.length) return fail(res, 'User not found', 404);
  const user = users[0];
  if (user.role === 'client') {
    return ok(res, await loadClientProfile(user.id, user));
  }
  return ok(res, await loadTherapistProfile(user.id, user));
});

async function syncList(table, docType, therapistId, items, columns) {
  const existing = await query(`SELECT id FROM ${table} WHERE therapist_id = :tid`, { tid: therapistId });
  const owned = new Set(existing.map((r) => Number(r.id)));
  const keep = new Set();
  for (const item of items) {
    const values = Object.fromEntries(columns.map((c) => [c, item[c] ?? null]));
    if (item.id && owned.has(Number(item.id))) {
      await query(
        `UPDATE ${table} SET ${columns.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id AND therapist_id = :tid`,
        { ...values, id: item.id, tid: therapistId }
      );
      keep.add(Number(item.id));
    } else {
      const result = await query(
        `INSERT INTO ${table} (therapist_id, ${columns.join(', ')}) VALUES (:tid, ${columns.map((c) => `:${c}`).join(', ')})`,
        { ...values, tid: therapistId }
      );
      keep.add(Number(result.insertId));
    }
  }
  for (const id of owned) {
    if (keep.has(id)) continue;
    await query(`DELETE FROM ${table} WHERE id = :id`, { id });
    await query(`DELETE FROM credential_documents WHERE owner_type = :t AND owner_id = :id`, { t: docType, id });
  }
}

const updateProfile = asyncHandler(async (req, res) => {
  const users = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!users.length) return fail(res, 'User not found', 404);
  const user = users[0];
  const p = req.body;

  if (user.role === 'therapist') {
    const texts = [p.bio, p.headline, ...(Array.isArray(p.frameworks) ? p.frameworks : [])];
    if (texts.some(hasContactDetails)) {
      return fail(res, 'Please remove phone numbers, emails and links. Clients book through Nafs.', 422);
    }
    // The Bio screen sends one `frameworks` list; split it so catalogue methods
    // become `practice_scope.modalities` and only the rest stay as `frameworks`.
    if (Array.isArray(p.frameworks) && p.practice_scope === undefined) {
      const catalogue = await query(`SELECT slug, name_en FROM modalities WHERE is_active = 1`);
      const byName = new Map(catalogue.flatMap((m) => [[m.name_en.toLowerCase(), m.slug], [m.slug.toLowerCase(), m.slug]]));
      const matched = new Set();
      const custom = [];
      for (const f of p.frameworks) {
        const slug = byName.get(String(f).trim().toLowerCase());
        if (slug) matched.add(slug);
        else custom.push(f);
      }
      const [row] = await query(`SELECT practice_scope FROM therapist_profiles WHERE user_id = :id`, { id: req.user.id });
      const current = parseJsonField(row?.practice_scope);
      p.practice_scope = { ...(current && typeof current === 'object' ? current : {}), modalities: [...matched] };
      p.frameworks = custom;
    }
  }

  if (user.role === 'therapist' && p.practice_scope?.age_groups?.includes('children') && !(await hasChildCertification(req.user.id))) {
    return fail(
      res,
      'Add a child-therapy certification with its document under License & Credentials before offering sessions to children.',
      422
    );
  }

  // Modalities must exist in the catalogue.
  if (user.role === 'therapist' && p.practice_scope?.modalities?.length) {
    const known = await query(`SELECT slug FROM modalities WHERE is_active = 1`);
    const slugs = new Set(known.map((m) => m.slug));
    if (p.practice_scope.modalities.some((m) => !slugs.has(m))) return fail(res, 'Unknown modality', 422);
  }

  // Validate focus areas up front so nothing is half-saved.
  let specializationIds = null;
  if (user.role === 'therapist' && Array.isArray(p.specialization_ids)) {
    specializationIds = [...new Set(p.specialization_ids.map(Number))];
    const valid = await query(
      `SELECT id FROM specializations WHERE is_active = 1 AND id IN (${specializationIds.map((_, i) => `:s${i}`).join(',')})`,
      Object.fromEntries(specializationIds.map((id, i) => [`s${i}`, id]))
    );
    if (valid.length !== specializationIds.length) return fail(res, 'Unknown or inactive specialization', 422);
  }

  const userFields = ['full_name', 'phone', 'avatar_url', 'locale'];
  const sets = [];
  const params = { id: req.user.id };
  for (const key of userFields) {
    if (p[key] !== undefined) {
      sets.push(`${key} = :${key}`);
      params[key] = p[key];
    }
  }
  if (sets.length) await query(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, params);

  if (user.role === 'client') {
    const map = {
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      city: p.city,
      country: p.country,
      timezone: p.timezone,
      about: p.about,
      preferred_therapist_gender: p.preferred_therapist_gender,
      emergency_contact_name: p.emergency_contact_name,
      emergency_contact_phone: p.emergency_contact_phone,
      preferred_language: p.locale,
      concerns: p.concerns !== undefined ? JSON.stringify(p.concerns) : undefined,
    };
    const updates = [];
    const cparams = { id: req.user.id };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        updates.push(`${key} = :${key}`);
        cparams[key] = value;
      }
    }
    await query(
      `INSERT INTO client_profiles (user_id) VALUES (:id)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      { id: req.user.id }
    );
    if (updates.length) {
      await query(`UPDATE client_profiles SET ${updates.join(', ')} WHERE user_id = :id`, cparams);
    }
  } else {
    const map = {
      bio: p.bio,
      headline: p.headline,
      frameworks: p.frameworks !== undefined ? JSON.stringify(p.frameworks) : undefined,
      native_language: p.native_language,
      languages: p.languages !== undefined ? JSON.stringify(p.languages) : undefined,
      city: p.city,
      country: p.country,
      address: p.address,
      timezone: p.timezone,
      video_meeting_url: p.video_meeting_url,
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      working_capacity: p.working_capacity,
      years_experience: p.years_experience,
      session_fee_default: p.session_fee_default,
      session_duration_minutes: p.session_duration_minutes,
      bank_name: p.bank_name,
      bank_account_holder: p.bank_account_holder,
      iban: p.iban === undefined ? undefined : p.iban || null,
      practice_scope: p.practice_scope !== undefined ? JSON.stringify(p.practice_scope) : undefined,
    };
    const updates = [];
    const tparams = { id: req.user.id };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        updates.push(`${key} = :${key}`);
        tparams[key] = value;
      }
    }
    await query(
      `INSERT INTO therapist_profiles (user_id) VALUES (:id)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      { id: req.user.id }
    );
    if (updates.length) {
      await query(
        `UPDATE therapist_profiles SET ${updates.join(', ')} WHERE user_id = :id`,
        tparams
      );
    }
    if (specializationIds) {
      await withTransaction(async (conn) => {
        await conn.execute(`DELETE FROM therapist_specializations WHERE therapist_id = :uid`, { uid: req.user.id });
        for (const sid of specializationIds) {
          await conn.execute(
            `INSERT INTO therapist_specializations (therapist_id, specialization_id) VALUES (:uid, :sid)`,
            { uid: req.user.id, sid }
          );
        }
      });
    }
    // Licenses / degrees are synced in place (rows with an `id` are updated,
    // rows without are inserted, rows left out are removed) so ids and any
    // attached document survive an ordinary save.
    if (Array.isArray(p.licenses)) {
      await syncList('therapist_licenses', 'license', req.user.id, p.licenses, ['license_number', 'expiry_date', 'issuer']);
    }
    if (Array.isArray(p.degrees)) {
      await syncList('therapist_degrees', 'degree', req.user.id, p.degrees.map((d) => ({ ...d, certifies_age_group: d.certifies_age_group || null })), ['degree_title', 'institution', 'year_awarded', 'certifies_age_group']);
      await enforceChildCertification(req.user.id);
    }
  }

  return getProfile(req, res);
});

// `POST /profile/avatar` (multipart field `avatar`). The image is stored in
// the database (`user_avatars`) so it survives redeploys and disk wipes, and is
// served by `GET /profile/avatar/:userId`.
const EXT = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(EXT[file.mimetype] ? null : new Error('INVALID_IMAGE'), !!EXT[file.mimetype]),
}).single('avatar');

const uploadAvatar = (req, res, next) =>
  avatarUpload(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_IMAGE') return fail(res, 'Photo must be a JPG, PNG or WebP image', 422);
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'Photo must be 3 MB or smaller', 422);
      return next(err);
    }
    if (!req.file) return fail(res, 'Attach the photo as the "avatar" field', 422);
    try {
      await query(
        `INSERT INTO user_avatars (user_id, mime, data) VALUES (:id, :mime, :data)
         ON DUPLICATE KEY UPDATE mime = VALUES(mime), data = VALUES(data)`,
        { id: req.user.id, mime: req.file.mimetype, data: req.file.buffer }
      );
      // `v` busts client image caches when the photo changes.
      // A loopback APP_URL (local dev) is unreachable from a phone, so use the host the app called.
      const base = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.app.url)
        ? `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`
        : env.app.url;
      const url = `${base}/api/v1/profile/avatar/${req.user.id}?v=${Date.now()}`;
      await query(`UPDATE users SET avatar_url = :url WHERE id = :id`, { url, id: req.user.id });
      return getProfile(req, res, next);
    } catch (e) {
      return next(e);
    }
  });

// Public so plain image widgets can load it without an auth header.
const getAvatar = asyncHandler(async (req, res) => {
  const [row] = await query(`SELECT mime, data FROM user_avatars WHERE user_id = :id`, { id: req.params.userId });
  if (!row) return fail(res, 'Photo not found', 404);
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=86400');
  return res.send(row.data);
});

module.exports = { updateSchema, getProfile, updateProfile, uploadAvatar, getAvatar };
