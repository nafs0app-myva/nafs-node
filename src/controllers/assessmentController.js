const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const startSchema = Joi.object({
  assessment_type: Joi.string()
    .valid('anxiety_stress', 'general_mood', 'age', 'gender', 'marital_status', 'sleep_quality', 'energy_level', 'full_intake')
    .required(),
});

const answerSchema = Joi.object({
  answers: Joi.array()
    .items(Joi.object({ question_key: Joi.string().required(), answer_value: Joi.alternatives().try(Joi.string(), Joi.number()).required() }))
    .min(1)
    .required(),
  complete: Joi.boolean().default(false),
  score: Joi.number().allow(null),
  summary: Joi.object().allow(null),
});

const goalsSchema = Joi.object({
  goals: Joi.array().items(Joi.string()).min(1).required(),
});

const start = asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO assessments (user_id, assessment_type, status) VALUES (:uid, :type, 'in_progress')`,
    { uid: req.user.id, type: req.body.assessment_type }
  );
  const rows = await query(`SELECT * FROM assessments WHERE id = :id`, { id: result.insertId });
  return ok(res, { assessment: rows[0] }, 'Assessment started', 201);
});

const saveAnswers = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM assessments WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Assessment not found', 404);
  for (const a of req.body.answers) {
    await query(
      `INSERT INTO assessment_answers (assessment_id, question_key, answer_value)
       VALUES (:aid, :qk, :av)`,
      { aid: req.params.id, qk: a.question_key, av: String(a.answer_value) }
    );
  }
  if (req.body.complete) {
    await query(
      `UPDATE assessments
       SET status = 'completed', completed_at = NOW(), score = :score, summary = :summary
       WHERE id = :id`,
      {
        id: req.params.id,
        score: req.body.score ?? null,
        summary: req.body.summary ? JSON.stringify(req.body.summary) : null,
      }
    );
  }
  const updated = await query(`SELECT * FROM assessments WHERE id = :id`, { id: req.params.id });
  const answers = await query(`SELECT question_key, answer_value FROM assessment_answers WHERE assessment_id = :id`, {
    id: req.params.id,
  });
  return ok(res, { assessment: updated[0], answers });
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM assessments WHERE user_id = :uid ORDER BY id DESC LIMIT 50`,
    { uid: req.user.id }
  );
  return ok(res, { assessments: rows });
});

const saveGoals = asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO user_goals (user_id, goals) VALUES (:uid, :goals)
     ON DUPLICATE KEY UPDATE goals = VALUES(goals)`,
    { uid: req.user.id, goals: JSON.stringify(req.body.goals) }
  );
  return ok(res, { goals: req.body.goals }, 'Goals saved');
});

const getGoals = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT goals FROM user_goals WHERE user_id = :uid`, { uid: req.user.id });
  let goals = rows[0]?.goals || [];
  if (typeof goals === 'string') {
    try {
      goals = JSON.parse(goals);
    } catch {
      goals = [];
    }
  }
  return ok(res, { goals });
});

module.exports = { startSchema, answerSchema, goalsSchema, start, saveAnswers, list, saveGoals, getGoals };
