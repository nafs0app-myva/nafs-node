const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const habitSchema = Joi.object({
  title: Joi.string().max(160).required(),
  description: Joi.string().allow('', null),
  icon: Joi.string().allow('', null),
  color: Joi.string().allow('', null),
  frequency: Joi.string().valid('daily', 'weekly').default('daily'),
  target_per_period: Joi.number().integer().min(1).default(1),
});

const logSchema = Joi.object({
  logged_on: Joi.date().iso().required(),
  count: Joi.number().integer().min(1).default(1),
  note: Joi.string().allow('', null),
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO habits (user_id, title, description, icon, color, frequency, target_per_period)
     VALUES (:user_id, :title, :description, :icon, :color, :frequency, :target_per_period)`,
    {
      user_id: req.user.id,
      title: p.title,
      description: p.description || null,
      icon: p.icon || null,
      color: p.color || null,
      frequency: p.frequency,
      target_per_period: p.target_per_period,
    }
  );
  const rows = await query(`SELECT * FROM habits WHERE id = :id`, { id: result.insertId });
  return ok(res, { habit: rows[0] }, 'Habit created', 201);
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM habits WHERE user_id = :user_id AND is_active = 1 ORDER BY id DESC`,
    { user_id: req.user.id }
  );
  return ok(res, { habits: rows });
});

const log = asyncHandler(async (req, res) => {
  const habitId = req.params.id;
  const habits = await query(`SELECT id FROM habits WHERE id = :id AND user_id = :user_id`, {
    id: habitId,
    user_id: req.user.id,
  });
  if (!habits.length) return fail(res, 'Habit not found', 404);

  await query(
    `INSERT INTO habit_logs (habit_id, user_id, logged_on, count, note)
     VALUES (:habit_id, :user_id, :logged_on, :count, :note)
     ON DUPLICATE KEY UPDATE count = VALUES(count), note = VALUES(note)`,
    {
      habit_id: habitId,
      user_id: req.user.id,
      logged_on: req.body.logged_on,
      count: req.body.count,
      note: req.body.note || null,
    }
  );
  return ok(res, null, 'Habit logged', 201);
});

const streak = asyncHandler(async (req, res) => {
  const habitId = req.params.id;
  const logs = await query(
    `SELECT logged_on FROM habit_logs
     WHERE habit_id = :habit_id AND user_id = :user_id
     ORDER BY logged_on DESC LIMIT 365`,
    { habit_id: habitId, user_id: req.user.id }
  );
  let streak = 0;
  let cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const dates = new Set(logs.map((l) => new Date(l.logged_on).toISOString().slice(0, 10)));
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dates.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return ok(res, { habit_id: Number(habitId), current_streak: streak });
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE habits SET is_active = 0 WHERE id = :id AND user_id = :user_id`,
    { id: req.params.id, user_id: req.user.id }
  );
  if (!result.affectedRows) return fail(res, 'Habit not found', 404);
  return ok(res, null, 'Habit archived');
});

module.exports = { habitSchema, logSchema, create, list, log, streak, remove };
