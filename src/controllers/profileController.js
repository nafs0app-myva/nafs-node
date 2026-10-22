const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

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
  timezone: Joi.string(),
  // Therapist
  bio: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  video_meeting_url: Joi.string().uri().allow('', null),
  working_capacity: Joi.string().valid('individual', 'team'),
  years_experience: Joi.number().integer().min(0),
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
  return {
    user,
    role: 'therapist',
    profile: profiles[0] || null,
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

const updateProfile = asyncHandler(async (req, res) => {
  const users = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!users.length) return fail(res, 'User not found', 404);
  const user = users[0];
  const p = req.body;

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
      city: p.city,
      country: p.country,
      address: p.address,
      timezone: p.timezone,
      video_meeting_url: p.video_meeting_url,
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      working_capacity: p.working_capacity,
      years_experience: p.years_experience,
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
  }

  return getProfile(req, res);
});

module.exports = { updateSchema, getProfile, updateProfile };
