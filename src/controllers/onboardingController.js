const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const completeSchema = Joi.object({
  goals: Joi.array().items(Joi.string()).default([]),
  interests: Joi.array().items(Joi.string()).default([]),
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  calculation_method: Joi.string().default('MWL'),
  madhab: Joi.string().valid('shafi', 'hanafi').default('shafi'),
  reminder_prefs: Joi.object().default({ prayer: true, dhikr: true, journal: true }),
});

const listSteps = asyncHandler(async (_req, res) => {
  const steps = await query(
    `SELECT id, slug, title, subtitle, image_url, sort_order
     FROM onboarding_steps WHERE is_active = 1 ORDER BY sort_order ASC`
  );
  return ok(res, { steps });
});

const complete = asyncHandler(async (req, res) => {
  const p = req.body;
  await query(
    `INSERT INTO user_profiles (user_id, city, country, latitude, longitude, calculation_method, madhab, goals, interests, reminder_prefs)
     VALUES (:user_id, :city, :country, :latitude, :longitude, :calculation_method, :madhab, :goals, :interests, :reminder_prefs)
     ON DUPLICATE KEY UPDATE
       city = VALUES(city),
       country = VALUES(country),
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       calculation_method = VALUES(calculation_method),
       madhab = VALUES(madhab),
       goals = VALUES(goals),
       interests = VALUES(interests),
       reminder_prefs = VALUES(reminder_prefs)`,
    {
      user_id: req.user.id,
      city: p.city || null,
      country: p.country || null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      calculation_method: p.calculation_method,
      madhab: p.madhab,
      goals: JSON.stringify(p.goals || []),
      interests: JSON.stringify(p.interests || []),
      reminder_prefs: JSON.stringify(p.reminder_prefs || {}),
    }
  );
  await query(`UPDATE users SET onboarding_completed = 1 WHERE id = :id`, { id: req.user.id });
  return ok(res, null, 'Onboarding completed');
});

const status = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT onboarding_completed FROM users WHERE id = :id`, { id: req.user.id });
  if (!rows.length) return fail(res, 'User not found', 404);
  return ok(res, { onboarding_completed: !!rows[0].onboarding_completed });
});

module.exports = { completeSchema, listSteps, complete, status };
