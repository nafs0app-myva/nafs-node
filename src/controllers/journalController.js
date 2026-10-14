const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const entrySchema = Joi.object({
  title: Joi.string().max(200).required(),
  body: Joi.string().required(),
  mood: Joi.string()
    .valid('grateful', 'calm', 'anxious', 'sad', 'hopeful', 'angry', 'neutral')
    .default('neutral'),
  tags: Joi.array().items(Joi.string()).default([]),
  is_private: Joi.boolean().default(true),
  entry_date: Joi.date().iso().required(),
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO journals (user_id, title, body, mood, tags, is_private, entry_date)
     VALUES (:user_id, :title, :body, :mood, :tags, :is_private, :entry_date)`,
    {
      user_id: req.user.id,
      title: p.title,
      body: p.body,
      mood: p.mood,
      tags: JSON.stringify(p.tags || []),
      is_private: p.is_private ? 1 : 0,
      entry_date: p.entry_date,
    }
  );
  const rows = await query(`SELECT * FROM journals WHERE id = :id`, { id: result.insertId });
  return ok(res, { entry: rows[0] }, 'Journal entry created', 201);
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, title, mood, tags, is_private, entry_date, created_at, updated_at
     FROM journals WHERE user_id = :user_id
     ORDER BY entry_date DESC, id DESC LIMIT 100`,
    { user_id: req.user.id }
  );
  return ok(res, { entries: rows });
});

const getOne = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM journals WHERE id = :id AND user_id = :user_id`, {
    id: req.params.id,
    user_id: req.user.id,
  });
  if (!rows.length) return fail(res, 'Entry not found', 404);
  return ok(res, { entry: rows[0] });
});

const update = asyncHandler(async (req, res) => {
  const existing = await query(`SELECT id FROM journals WHERE id = :id AND user_id = :user_id`, {
    id: req.params.id,
    user_id: req.user.id,
  });
  if (!existing.length) return fail(res, 'Entry not found', 404);
  const p = req.body;
  await query(
    `UPDATE journals
     SET title = :title, body = :body, mood = :mood, tags = :tags,
         is_private = :is_private, entry_date = :entry_date
     WHERE id = :id`,
    {
      id: req.params.id,
      title: p.title,
      body: p.body,
      mood: p.mood,
      tags: JSON.stringify(p.tags || []),
      is_private: p.is_private ? 1 : 0,
      entry_date: p.entry_date,
    }
  );
  const rows = await query(`SELECT * FROM journals WHERE id = :id`, { id: req.params.id });
  return ok(res, { entry: rows[0] }, 'Updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM journals WHERE id = :id AND user_id = :user_id`, {
    id: req.params.id,
    user_id: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Entry not found', 404);
  return ok(res, null, 'Deleted');
});

module.exports = { entrySchema, create, list, getOne, update, remove };
