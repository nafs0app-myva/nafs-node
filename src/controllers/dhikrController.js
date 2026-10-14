const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const startSchema = Joi.object({
  preset_id: Joi.number().integer().allow(null),
  title: Joi.string().max(160),
  target_count: Joi.number().integer().min(1).max(10000),
}).or('preset_id', 'title');

const tickSchema = Joi.object({
  increment: Joi.number().integer().min(1).max(100).default(1),
});

const listPresets = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, title, arabic_text, transliteration, translation, target_count, category
     FROM dhikr_presets WHERE is_active = 1 ORDER BY id ASC`
  );
  return ok(res, { presets: rows });
});

const startSession = asyncHandler(async (req, res) => {
  let title = req.body.title;
  let target = req.body.target_count;
  let presetId = req.body.preset_id || null;

  if (presetId) {
    const presets = await query(`SELECT * FROM dhikr_presets WHERE id = :id`, { id: presetId });
    if (!presets.length) return fail(res, 'Preset not found', 404);
    title = title || presets[0].title;
    target = target || presets[0].target_count;
  }
  if (!title || !target) return fail(res, 'title and target_count required', 422);

  const result = await query(
    `INSERT INTO dhikr_sessions (user_id, preset_id, title, target_count)
     VALUES (:user_id, :preset_id, :title, :target_count)`,
    { user_id: req.user.id, preset_id: presetId, title, target_count: target }
  );
  const rows = await query(`SELECT * FROM dhikr_sessions WHERE id = :id`, { id: result.insertId });
  return ok(res, { session: rows[0] }, 'Session started', 201);
});

const tick = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const sessions = await query(`SELECT * FROM dhikr_sessions WHERE id = :id AND user_id = :user_id`, {
    id,
    user_id: req.user.id,
  });
  if (!sessions.length) return fail(res, 'Session not found', 404);
  const session = sessions[0];
  if (session.completed) return fail(res, 'Session already completed', 400);

  const next = Math.min(session.current_count + req.body.increment, session.target_count);
  const completed = next >= session.target_count ? 1 : 0;
  await query(
    `UPDATE dhikr_sessions
     SET current_count = :current_count, completed = :completed,
         completed_at = IF(:completed = 1, CURRENT_TIMESTAMP, completed_at)
     WHERE id = :id`,
    { id, current_count: next, completed }
  );
  const rows = await query(`SELECT * FROM dhikr_sessions WHERE id = :id`, { id });
  return ok(res, { session: rows[0] });
});

const history = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, title, target_count, current_count, completed, started_at, completed_at
     FROM dhikr_sessions WHERE user_id = :user_id
     ORDER BY id DESC LIMIT 50`,
    { user_id: req.user.id }
  );
  return ok(res, { sessions: rows });
});

module.exports = { startSchema, tickSchema, listPresets, startSession, tick, history };
