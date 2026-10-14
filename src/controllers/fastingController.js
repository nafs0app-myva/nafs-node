const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const logSchema = Joi.object({
  fast_date: Joi.date().iso().required(),
  fast_type: Joi.string().valid('ramadan', 'sunnah', 'qada', 'kafarah', 'other').default('sunnah'),
  status: Joi.string().valid('completed', 'missed', 'planned').default('completed'),
  notes: Joi.string().allow('', null),
});

const upsert = asyncHandler(async (req, res) => {
  const p = req.body;
  await query(
    `INSERT INTO fasting_logs (user_id, fast_date, fast_type, status, notes)
     VALUES (:user_id, :fast_date, :fast_type, :status, :notes)
     ON DUPLICATE KEY UPDATE fast_type = VALUES(fast_type), status = VALUES(status), notes = VALUES(notes)`,
    {
      user_id: req.user.id,
      fast_date: p.fast_date,
      fast_type: p.fast_type,
      status: p.status,
      notes: p.notes || null,
    }
  );
  return ok(res, null, 'Fasting log saved', 201);
});

const list = asyncHandler(async (req, res) => {
  const month = req.query.month;
  let rows;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 'month must be YYYY-MM', 422);
    rows = await query(
      `SELECT * FROM fasting_logs
       WHERE user_id = :user_id AND DATE_FORMAT(fast_date, '%Y-%m') = :month
       ORDER BY fast_date DESC`,
      { user_id: req.user.id, month }
    );
  } else {
    rows = await query(
      `SELECT * FROM fasting_logs WHERE user_id = :user_id ORDER BY fast_date DESC LIMIT 100`,
      { user_id: req.user.id }
    );
  }
  return ok(res, { logs: rows });
});

module.exports = { logSchema, upsert, list };
