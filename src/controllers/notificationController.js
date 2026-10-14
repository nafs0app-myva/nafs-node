const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const deviceSchema = Joi.object({
  token: Joi.string().required(),
  platform: Joi.string().valid('ios', 'android', 'web').required(),
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, title, body, type, data, is_read, created_at
     FROM notifications WHERE user_id = :user_id
     ORDER BY id DESC LIMIT 100`,
    { user_id: req.user.id }
  );
  return ok(res, { notifications: rows });
});

const markRead = asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE notifications SET is_read = 1 WHERE id = :id AND user_id = :user_id`,
    { id: req.params.id, user_id: req.user.id }
  );
  if (!result.affectedRows) return fail(res, 'Notification not found', 404);
  return ok(res, null, 'Marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET is_read = 1 WHERE user_id = :user_id AND is_read = 0`, {
    user_id: req.user.id,
  });
  return ok(res, null, 'All marked as read');
});

const registerDevice = asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES (:user_id, :token, :platform)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform)`,
    { user_id: req.user.id, token: req.body.token, platform: req.body.platform }
  );
  return ok(res, null, 'Device registered', 201);
});

module.exports = { deviceSchema, list, markRead, markAllRead, registerDevice };
