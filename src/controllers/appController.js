const Joi = require('joi');
const { query } = require('../config/db');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const settingsSchema = Joi.object({
  locale: Joi.string().valid('en', 'ar'),
  push_enabled: Joi.boolean(),
  email_enabled: Joi.boolean(),
  sms_enabled: Joi.boolean(),
}).min(1);

/** Splash / app bootstrap used by first Figma pages */
const bootstrap = asyncHandler(async (_req, res) => {
  return ok(res, {
    app_name: 'Nafs',
    languages: [
      { code: 'en', label: 'English' },
      { code: 'ar', label: 'العربية' },
    ],
    roles: ['therapist', 'client'],
    support_email: 'support@nafs.app',
    force_update: false,
    min_version: '1.0.0',
  });
});

const getSettings = asyncHandler(async (req, res) => {
  const [user] = await query(`SELECT locale FROM users WHERE id = :id`, { id: req.user.id });
  // lightweight prefs stored on profile.admin_notes JSON fallback — use dedicated defaults
  return ok(res, {
    locale: user?.locale || 'en',
    push_enabled: true,
    email_enabled: true,
    sms_enabled: false,
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  if (req.body.locale) {
    await query(`UPDATE users SET locale = :locale WHERE id = :id`, {
      locale: req.body.locale,
      id: req.user.id,
    });
  }
  return getSettings(req, res);
});

module.exports = { settingsSchema, bootstrap, getSettings, updateSettings };
