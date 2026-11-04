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
  // Optional: answering a rotating journal prompt marks it done for this user.
  prompt_id: Joi.number().integer().positive().allow(null),
});

const promptAdminSchema = Joi.object({
  text_en: Joi.string().trim().min(3).max(500).required(),
  text_ar: Joi.string().trim().max(500).allow('', null),
  sort_order: Joi.number().integer().default(0),
  is_active: Joi.boolean().default(true),
});

const promptAdminUpdateSchema = Joi.object({
  text_en: Joi.string().trim().min(3).max(500),
  text_ar: Joi.string().trim().max(500).allow('', null),
  sort_order: Joi.number().integer(),
  is_active: Joi.boolean(),
}).min(1);

function localizePrompt(row, locale) {
  if (!row) return null;
  const useAr = locale === 'ar' && row.text_ar;
  return {
    id: row.id,
    text: useAr ? row.text_ar : row.text_en,
    text_en: row.text_en,
    text_ar: row.text_ar,
    sort_order: row.sort_order,
  };
}

/**
 * GET /journals/prompt
 * Next unanswered active prompt for this user (by sort_order).
 * Stays the same until they POST /journals with that prompt_id.
 * ?loop=false → null when the pool is exhausted (default loops to the first).
 * ?locale=ar → prefer text_ar when present.
 */
const getPrompt = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  const loop = String(req.query.loop ?? 'true').toLowerCase() !== 'false';

  const prompts = await query(
    `SELECT id, text_en, text_ar, sort_order
     FROM journal_prompts
     WHERE is_active = 1
     ORDER BY sort_order ASC, id ASC`
  );
  if (!prompts.length) {
    return ok(res, { prompt: null, remaining: 0, total: 0 });
  }

  const answered = await query(
    `SELECT DISTINCT prompt_id AS id
     FROM journal_entries
     WHERE user_id = :uid AND prompt_id IS NOT NULL`,
    { uid: req.user.id }
  );
  const answeredIds = new Set(answered.map((r) => Number(r.id)));
  const unanswered = prompts.filter((p) => !answeredIds.has(Number(p.id)));
  const next = unanswered[0] || (loop ? prompts[0] : null);

  return ok(res, {
    prompt: localizePrompt(next, locale),
    remaining: unanswered.length,
    total: prompts.length,
    looped: unanswered.length === 0 && !!next,
  });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  let promptId = p.prompt_id || null;
  if (promptId) {
    const [prompt] = await query(
      `SELECT id FROM journal_prompts WHERE id = :id AND is_active = 1`,
      { id: promptId }
    );
    if (!prompt) return fail(res, 'Journal prompt not found or inactive', 404);
  }

  const result = await query(
    `INSERT INTO journal_entries
      (user_id, prompt_id, entry_type, title, body, mood_tag, media_url, is_pinned, entry_date)
     VALUES (:uid, :prompt_id, :entry_type, :title, :body, :mood_tag, :media_url, :is_pinned, :entry_date)`,
    {
      uid: req.user.id,
      prompt_id: promptId,
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
  if (req.query.prompt_id) {
    sql += ` AND prompt_id = :prompt_id`;
    params.prompt_id = Number(req.query.prompt_id);
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
  if (p.prompt_id) {
    const [prompt] = await query(
      `SELECT id FROM journal_prompts WHERE id = :id AND is_active = 1`,
      { id: p.prompt_id }
    );
    if (!prompt) return fail(res, 'Journal prompt not found or inactive', 404);
  }
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
  if (Object.prototype.hasOwnProperty.call(p, 'prompt_id')) {
    await query(`UPDATE journal_entries SET prompt_id = :prompt_id WHERE id = :id`, {
      id: req.params.id,
      prompt_id: p.prompt_id || null,
    });
  }
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

// --- Admin: manage the prompt pool ---

const listPromptsAdmin = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, text_en, text_ar, sort_order, is_active, created_at
     FROM journal_prompts ORDER BY sort_order ASC, id ASC`
  );
  return ok(res, { prompts: rows });
});

const createPromptAdmin = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO journal_prompts (text_en, text_ar, sort_order, is_active)
     VALUES (:text_en, :text_ar, :sort_order, :is_active)`,
    {
      text_en: p.text_en,
      text_ar: p.text_ar || null,
      sort_order: p.sort_order ?? 0,
      is_active: p.is_active === false ? 0 : 1,
    }
  );
  const [row] = await query(`SELECT * FROM journal_prompts WHERE id = :id`, { id: result.insertId });
  return ok(res, { prompt: row }, 'Prompt created', 201);
});

const updatePromptAdmin = asyncHandler(async (req, res) => {
  const [existing] = await query(`SELECT * FROM journal_prompts WHERE id = :id`, { id: req.params.id });
  if (!existing) return fail(res, 'Prompt not found', 404);
  const p = req.body;
  await query(
    `UPDATE journal_prompts SET
       text_en = COALESCE(:text_en, text_en),
       text_ar = COALESCE(:text_ar, text_ar),
       sort_order = COALESCE(:sort_order, sort_order),
       is_active = COALESCE(:is_active, is_active)
     WHERE id = :id`,
    {
      id: existing.id,
      text_en: p.text_en ?? null,
      text_ar: p.text_ar === undefined ? null : p.text_ar || null,
      sort_order: p.sort_order ?? null,
      is_active: p.is_active === undefined ? null : p.is_active ? 1 : 0,
    }
  );
  if (p.text_ar === null || p.text_ar === '') {
    await query(`UPDATE journal_prompts SET text_ar = NULL WHERE id = :id`, { id: existing.id });
  }
  const [row] = await query(`SELECT * FROM journal_prompts WHERE id = :id`, { id: existing.id });
  return ok(res, { prompt: row }, 'Prompt updated');
});

module.exports = {
  entrySchema,
  promptAdminSchema,
  promptAdminUpdateSchema,
  getPrompt,
  create,
  list,
  getOne,
  update,
  remove,
  listPromptsAdmin,
  createPromptAdmin,
  updatePromptAdmin,
};
