const Joi = require('joi');
const { query } = require('../config/db');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const progressSchema = Joi.object({
  surah: Joi.number().integer().min(1).max(114).required(),
  ayah: Joi.number().integer().min(1).required(),
  notes: Joi.string().allow('', null),
});

const reflectionSchema = Joi.object({
  surah: Joi.number().integer().min(1).max(114).allow(null),
  ayah: Joi.number().integer().min(1).allow(null),
  prompt: Joi.string().allow('', null),
  body: Joi.string().required(),
});

const getProgress = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM quran_progress WHERE user_id = :user_id`, {
    user_id: req.user.id,
  });
  return ok(res, { progress: rows[0] || null });
});

const upsertProgress = asyncHandler(async (req, res) => {
  const p = req.body;
  await query(
    `INSERT INTO quran_progress (user_id, surah, ayah, notes, last_read_at)
     VALUES (:user_id, :surah, :ayah, :notes, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE surah = VALUES(surah), ayah = VALUES(ayah),
       notes = VALUES(notes), last_read_at = CURRENT_TIMESTAMP`,
    {
      user_id: req.user.id,
      surah: p.surah,
      ayah: p.ayah,
      notes: p.notes || null,
    }
  );
  const rows = await query(`SELECT * FROM quran_progress WHERE user_id = :user_id`, {
    user_id: req.user.id,
  });
  return ok(res, { progress: rows[0] }, 'Progress saved');
});

const createReflection = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO reflections (user_id, surah, ayah, prompt, body)
     VALUES (:user_id, :surah, :ayah, :prompt, :body)`,
    {
      user_id: req.user.id,
      surah: p.surah ?? null,
      ayah: p.ayah ?? null,
      prompt: p.prompt || null,
      body: p.body,
    }
  );
  const rows = await query(`SELECT * FROM reflections WHERE id = :id`, { id: result.insertId });
  return ok(res, { reflection: rows[0] }, 'Reflection saved', 201);
});

const listReflections = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM reflections WHERE user_id = :user_id ORDER BY id DESC LIMIT 100`,
    { user_id: req.user.id }
  );
  return ok(res, { reflections: rows });
});

module.exports = {
  progressSchema,
  reflectionSchema,
  getProgress,
  upsertProgress,
  createReflection,
  listReflections,
};
