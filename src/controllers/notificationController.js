const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const deviceSchema = Joi.object({
  token: Joi.string().required(),
  platform: Joi.string().valid('ios', 'android', 'web').required(),
  device_name: Joi.string().allow('', null),
});

const prefsSchema = Joi.object({
  client_bookings: Joi.boolean(),
  clinical_alerts: Joi.boolean(),
  financial: Joi.boolean(),
  push_channel: Joi.boolean(),
  email_channel: Joi.boolean(),
  sms_channel: Joi.boolean(),
}).min(1);

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, title, body, type, data, is_read, created_at
     FROM notifications WHERE user_id = :uid ORDER BY id DESC LIMIT 100`,
    { uid: req.user.id }
  );
  return ok(res, { notifications: rows });
});

const markRead = asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE notifications SET is_read = 1 WHERE id = :id AND user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!result.affectedRows) return fail(res, 'Notification not found', 404);
  return ok(res, null, 'Marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET is_read = 1 WHERE user_id = :uid AND is_read = 0`, {
    uid: req.user.id,
  });
  return ok(res, null, 'All marked as read');
});

const registerDevice = asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO device_tokens (user_id, token, platform, device_name, last_active_at)
     VALUES (:uid, :token, :platform, :device_name, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform),
       device_name = COALESCE(VALUES(device_name), device_name), last_active_at = NOW()`,
    {
      uid: req.user.id,
      token: req.body.token,
      platform: req.body.platform,
      device_name: req.body.device_name || null,
    }
  );
  return ok(res, null, 'Device registered', 201);
});

const listDevices = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, token, platform, device_name, last_active_at, created_at
     FROM device_tokens WHERE user_id = :uid ORDER BY last_active_at DESC, id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { devices: rows });
});

const revokeDevice = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM device_tokens WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Device not found', 404);
  return ok(res, null, 'Device revoked');
});

const getPrefs = asyncHandler(async (req, res) => {
  let rows = await query(`SELECT * FROM notification_preferences WHERE user_id = :uid`, {
    uid: req.user.id,
  });
  if (!rows.length) {
    await query(`INSERT INTO notification_preferences (user_id) VALUES (:uid)`, { uid: req.user.id });
    rows = await query(`SELECT * FROM notification_preferences WHERE user_id = :uid`, {
      uid: req.user.id,
    });
  }
  return ok(res, { preferences: rows[0] });
});

const updatePrefs = asyncHandler(async (req, res) => {
  let rows = await query(`SELECT * FROM notification_preferences WHERE user_id = :uid`, {
    uid: req.user.id,
  });
  if (!rows.length) {
    await query(`INSERT INTO notification_preferences (user_id) VALUES (:uid)`, { uid: req.user.id });
  }
  const p = req.body;
  const fields = [];
  const params = { uid: req.user.id };
  for (const key of [
    'client_bookings',
    'clinical_alerts',
    'financial',
    'push_channel',
    'email_channel',
    'sms_channel',
  ]) {
    if (p[key] !== undefined) {
      fields.push(`${key} = :${key}`);
      params[key] = p[key] ? 1 : 0;
    }
  }
  if (fields.length) {
    await query(`UPDATE notification_preferences SET ${fields.join(', ')} WHERE user_id = :uid`, params);
  }
  rows = await query(`SELECT * FROM notification_preferences WHERE user_id = :uid`, {
    uid: req.user.id,
  });
  return ok(res, { preferences: rows[0] }, 'Preferences updated');
});

module.exports = {
  deviceSchema,
  prefsSchema,
  list,
  markRead,
  markAllRead,
  registerDevice,
  listDevices,
  revokeDevice,
  getPrefs,
  updatePrefs,
};
