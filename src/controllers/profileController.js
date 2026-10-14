const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const updateSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  gender: Joi.string().valid('male', 'female', 'unspecified'),
  timezone: Joi.string(),
  locale: Joi.string(),
  bio: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  calculation_method: Joi.string(),
  madhab: Joi.string().valid('shafi', 'hanafi'),
  reminder_prefs: Joi.object(),
}).min(1);

const getProfile = asyncHandler(async (req, res) => {
  const users = await query(
    `SELECT id, email, phone, full_name, avatar_url, gender, timezone, locale,
            is_verified, onboarding_completed, created_at
     FROM users WHERE id = :id`,
    { id: req.user.id }
  );
  if (!users.length) return fail(res, 'User not found', 404);
  const profiles = await query(`SELECT * FROM user_profiles WHERE user_id = :id`, { id: req.user.id });
  return ok(res, { user: users[0], profile: profiles[0] || null });
});

const updateProfile = asyncHandler(async (req, res) => {
  const p = req.body;
  const userFields = ['full_name', 'phone', 'avatar_url', 'gender', 'timezone', 'locale'];
  const sets = [];
  const params = { id: req.user.id };
  for (const key of userFields) {
    if (p[key] !== undefined) {
      sets.push(`${key} = :${key}`);
      params[key] = p[key];
    }
  }
  if (sets.length) {
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, params);
  }

  const profileKeys = [
    'bio',
    'city',
    'country',
    'latitude',
    'longitude',
    'calculation_method',
    'madhab',
    'reminder_prefs',
  ];
  const hasProfile = profileKeys.some((k) => p[k] !== undefined);
  if (hasProfile) {
    await query(
      `INSERT INTO user_profiles (user_id, bio, city, country, latitude, longitude, calculation_method, madhab, reminder_prefs)
       VALUES (:user_id, :bio, :city, :country, :latitude, :longitude, :calculation_method, :madhab, :reminder_prefs)
       ON DUPLICATE KEY UPDATE
         bio = COALESCE(VALUES(bio), bio),
         city = COALESCE(VALUES(city), city),
         country = COALESCE(VALUES(country), country),
         latitude = COALESCE(VALUES(latitude), latitude),
         longitude = COALESCE(VALUES(longitude), longitude),
         calculation_method = COALESCE(VALUES(calculation_method), calculation_method),
         madhab = COALESCE(VALUES(madhab), madhab),
         reminder_prefs = COALESCE(VALUES(reminder_prefs), reminder_prefs)`,
      {
        user_id: req.user.id,
        bio: p.bio ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        calculation_method: p.calculation_method ?? null,
        madhab: p.madhab ?? null,
        reminder_prefs: p.reminder_prefs ? JSON.stringify(p.reminder_prefs) : null,
      }
    );
  }

  return getProfile(req, res);
});

module.exports = { updateSchema, getProfile, updateProfile };
