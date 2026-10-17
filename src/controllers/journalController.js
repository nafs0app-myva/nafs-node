const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const entrySchema = Joi.object({
  entry_type: Joi.string().valid('text', 'audio', 'image', 'gratitude').default('text'),
  title: Joi.string().allow('', null),
  body: Joi.string().allow('', null),
  mood_tag: Joi.string().allow('', null),
  media_url: Joi.string().uri().allow('', null),
  is_pinned: Joi.boolean().default(false),
  entry_date: Joi.date().iso().required(),
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO journal_entries
      (user_id, entry_type, title, body, mood_tag, media_url, is_pinned, entry_date)
     VALUES (:uid, :entry_type, :title, :body, :mood_tag, :media_url, :is_pinned, :entry_date)`,
    {
      uid: req.user.id,
      entry_type: p.entry_type,
      title: p.title || null,
      body: p.body || null,
      mood_tag: p.mood_tag || null,
      media_url: p.media_url || null,
      is_pinned: p.is_pinned ? 1 : 0,
      entry_date: p.entry_date,
    }
  );
  const rows = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: result.insertId });
  return ok(res, { entry: rows[0] }, 'Journal entry created', 201);
});

const list = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT * FROM journal_entries WHERE user_id = :uid`;
  const params = { uid: req.user.id };
  if (q) {
    sql += ` AND (title LIKE :q OR body LIKE :q)`;
    params.q = `%${q}%`;
  }
  sql += ` ORDER BY is_pinned DESC, entry_date DESC, id DESC LIMIT 100`;
  const rows = await query(sql, params);
  return ok(res, { entries: rows });
});

const getOne = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Entry not found', 404);
  return ok(res, { entry: rows[0] });
});

const update = asyncHandler(async (req, res) => {
  const existing = await query(`SELECT id FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing.length) return fail(res, 'Entry not found', 404);
  const p = req.body;
  await query(
    `UPDATE journal_entries
     SET entry_type = :entry_type, title = :title, body = :body, mood_tag = :mood_tag,
         media_url = :media_url, is_pinned = :is_pinned, entry_date = :entry_date
     WHERE id = :id`,
    {
      id: req.params.id,
      entry_type: p.entry_type,
      title: p.title || null,
      body: p.body || null,
      mood_tag: p.mood_tag || null,
      media_url: p.media_url || null,
      is_pinned: p.is_pinned ? 1 : 0,
      entry_date: p.entry_date,
    }
  );
  const rows = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: req.params.id });
  return ok(res, { entry: rows[0] }, 'Updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Entry not found', 404);
  return ok(res, null, 'Deleted');
});

module.exports = { entrySchema, create, list, getOne, update, remove };
