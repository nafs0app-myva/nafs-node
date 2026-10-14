const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const logSchema = Joi.object({
  prayer_name: Joi.string().valid('fajr', 'dhuhr', 'asr', 'maghrib', 'isha').required(),
  prayed_on: Joi.date().iso().required(),
  status: Joi.string().valid('on_time', 'late', 'missed', 'qada').default('on_time'),
  notes: Joi.string().allow('', null),
});

const logPrayer = asyncHandler(async (req, res) => {
  const p = req.body;
  await query(
    `INSERT INTO prayer_logs (user_id, prayer_name, prayed_on, status, notes)
     VALUES (:user_id, :prayer_name, :prayed_on, :status, :notes)
     ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), logged_at = CURRENT_TIMESTAMP`,
    {
      user_id: req.user.id,
      prayer_name: p.prayer_name,
      prayed_on: p.prayed_on,
      status: p.status,
      notes: p.notes || null,
    }
  );
  return ok(res, null, 'Prayer logged', 201);
});

const listDay = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = await query(
    `SELECT id, prayer_name, prayed_on, status, notes, logged_at
     FROM prayer_logs WHERE user_id = :user_id AND prayed_on = :date
     ORDER BY FIELD(prayer_name,'fajr','dhuhr','asr','maghrib','isha')`,
    { user_id: req.user.id, date }
  );
  return ok(res, { date, prayers: rows });
});

const calendar = asyncHandler(async (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(res, 'Query month required as YYYY-MM', 422);
  }
  const rows = await query(
    `SELECT prayed_on, prayer_name, status
     FROM prayer_logs
     WHERE user_id = :user_id AND DATE_FORMAT(prayed_on, '%Y-%m') = :month
     ORDER BY prayed_on ASC`,
    { user_id: req.user.id, month }
  );
  return ok(res, { month, logs: rows });
});

module.exports = { logSchema, logPrayer, listDay, calendar };
