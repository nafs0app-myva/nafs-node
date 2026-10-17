const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const updateSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  locale: Joi.string().valid('en', 'ar'),
  bio: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  timezone: Joi.string(),
  video_meeting_url: Joi.string().uri().allow('', null),
}).min(1);

const getProfile = asyncHandler(async (req, res) => {
  const users = await query(
    `SELECT id, email, phone, full_name, avatar_url, role, locale, is_verified, created_at
     FROM users WHERE id = :id`,
    { id: req.user.id }
  );
  if (!users.length) return fail(res, 'User not found', 404);
  const profiles = await query(`SELECT * FROM therapist_profiles WHERE user_id = :id`, {
    id: req.user.id,
  });
  const specs = await query(
    `SELECT s.id, s.slug, s.name_en, s.name_ar
     FROM therapist_specializations ts
     JOIN specializations s ON s.id = ts.specialization_id
     WHERE ts.therapist_id = :id`,
    { id: req.user.id }
  );
  const licenses = await query(`SELECT * FROM therapist_licenses WHERE therapist_id = :id`, {
    id: req.user.id,
  });
  const degrees = await query(`SELECT * FROM therapist_degrees WHERE therapist_id = :id`, {
    id: req.user.id,
  });
  return ok(res, {
    user: users[0],
    profile: profiles[0] || null,
    specializations: specs,
    licenses,
    degrees,
  });
});

const updateProfile = asyncHandler(async (req, res) => {
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

  const profileKeys = ['bio', 'city', 'country', 'address', 'timezone', 'video_meeting_url'];
  if (profileKeys.some((k) => p[k] !== undefined)) {
    await query(
      `INSERT INTO therapist_profiles (user_id, bio, city, country, address, timezone, video_meeting_url)
       VALUES (:id, :bio, :city, :country, :address, :timezone, :video_meeting_url)
       ON DUPLICATE KEY UPDATE
         bio = COALESCE(VALUES(bio), bio),
         city = COALESCE(VALUES(city), city),
         country = COALESCE(VALUES(country), country),
         address = COALESCE(VALUES(address), address),
         timezone = COALESCE(VALUES(timezone), timezone),
         video_meeting_url = COALESCE(VALUES(video_meeting_url), video_meeting_url)`,
      {
        id: req.user.id,
        bio: p.bio ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        address: p.address ?? null,
        timezone: p.timezone ?? null,
        video_meeting_url: p.video_meeting_url ?? null,
      }
    );
  }
  return getProfile(req, res);
});

module.exports = { updateSchema, getProfile, updateProfile };
