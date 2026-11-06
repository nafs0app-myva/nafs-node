const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { deleteRecordingRow, MEDIA_COLUMNS, publicRecording } = require('./privacyController');

const MAX_BLOCKS = 50;

const blockInputSchema = Joi.object({
  type: Joi.string().valid('text', 'audio', 'image', 'video').required(),
  text: Joi.string().allow('', null),
  media_id: Joi.number().integer().positive().allow(null),
}).custom((value, helpers) => {
  if (value.type === 'text') {
    if (!value.text || !String(value.text).trim()) {
      return helpers.message('text blocks require non-empty text');
    }
  } else if (!value.media_id) {
    return helpers.message(`${value.type} blocks require media_id`);
  }
  return value;
});

// Shared create/update schema. No Joi defaults — PUT must not invent fields the client omitted.
const entrySchema = Joi.object({
  entry_type: Joi.string().valid('text', 'audio', 'image', 'video', 'gratitude', 'mixed'),
  title: Joi.string().allow('', null),
  body: Joi.string().allow('', null),
  mood_tag: Joi.string().allow('', null),
  media_url: Joi.string().uri().allow('', null),
  // Ordered blocks (preferred).
  blocks: Joi.array().items(blockInputSchema).min(1).max(MAX_BLOCKS),
  // Legacy multi-media helpers (still accepted; converted to blocks when blocks is absent).
  media: Joi.array()
    .items(
      Joi.object({
        id: Joi.number().integer().positive(),
        type: Joi.string().valid('audio', 'image', 'video', 'file', 'photo'),
        media_type: Joi.string().valid('audio', 'image', 'video', 'file', 'photo'),
        url: Joi.string().uri().allow('', null),
        title: Joi.string().allow('', null),
        media_id: Joi.number().integer().positive(),
      })
    )
    .max(MAX_BLOCKS),
  media_ids: Joi.array().items(Joi.number().integer().positive()).max(MAX_BLOCKS),
  notes: Joi.array().items(Joi.string().allow('')).max(MAX_BLOCKS),
  is_pinned: Joi.boolean(),
  entry_date: Joi.alternatives().try(Joi.date().iso(), Joi.string()),
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

function normalizeEntryDate(value) {
  if (!value) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function toMysqlDateTime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function expectedMediaType(blockType) {
  if (blockType === 'image') return 'photo';
  return blockType;
}

function inferEntryType(requested, blocks) {
  if (requested === 'gratitude') return 'gratitude';
  const kinds = [...new Set(blocks.map((b) => b.type))];
  if (kinds.length === 0) return requested || 'text';
  if (kinds.length > 1) return 'mixed';
  return kinds[0];
}

/** Convert legacy body/media/notes/media_url into a blocks[] array. */
function legacyToBlocks(p) {
  const blocks = [];
  if (Array.isArray(p.notes) && p.notes.length) {
    for (const note of p.notes) {
      if (note && String(note).trim()) blocks.push({ type: 'text', text: String(note).trim() });
    }
  } else if (p.body && String(p.body).trim()) {
    blocks.push({ type: 'text', text: String(p.body).trim() });
  }
  if (Array.isArray(p.media_ids)) {
    for (const id of p.media_ids) blocks.push({ type: 'image', media_id: Number(id) });
  }
  if (Array.isArray(p.media)) {
    for (const m of p.media) {
      const mid = m.media_id || m.id;
      const rawType = m.type || m.media_type || 'image';
      const type = rawType === 'photo' || rawType === 'file' ? 'image' : rawType;
      if (mid) blocks.push({ type: ['audio', 'image', 'video'].includes(type) ? type : 'image', media_id: Number(mid) });
      else if (m.url) {
        // External URL without id — handled later by creating a media_recordings stub.
        blocks.push({ type: ['audio', 'image', 'video'].includes(type) ? type : 'image', url: m.url, title: m.title });
      }
    }
  }
  if (!blocks.some((b) => b.media_id || b.url) && p.media_url) {
    const t = p.entry_type === 'audio' || p.entry_type === 'video' ? p.entry_type : 'image';
    blocks.push({ type: t, url: p.media_url });
  }
  if (!blocks.length && (p.title || p.body || p.mood_tag)) {
    blocks.push({ type: 'text', text: (p.body && String(p.body).trim()) || p.title || '' });
  }
  return blocks.slice(0, MAX_BLOCKS);
}

async function loadBlocks(entryId) {
  const rows = await query(
    `SELECT b.id, b.type, b.sort_order AS \`order\`, b.text, b.media_id,
            m.url, m.thumbnail_url, m.duration_seconds, m.media_type, m.file_mime
     FROM journal_blocks b
     LEFT JOIN media_recordings m ON m.id = b.media_id
     WHERE b.journal_entry_id = :eid
     ORDER BY b.sort_order ASC, b.id ASC`,
    { eid: entryId }
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    order: r.order,
    text: r.type === 'text' ? r.text : undefined,
    media_id: r.media_id || undefined,
    url: r.url || undefined,
    thumbnail_url: r.thumbnail_url || undefined,
    duration_seconds: r.duration_seconds != null ? Number(r.duration_seconds) : undefined,
  }));
}

async function formatEntry(row, { fullBlocks = true } = {}) {
  if (!row) return null;
  const blocks = await loadBlocks(row.id);
  const firstText = blocks.find((b) => b.type === 'text');
  const firstMedia = blocks.find((b) => b.type !== 'text');
  const base = {
    ...row,
    entry_date: row.entry_date instanceof Date ? row.entry_date.toISOString() : row.entry_date,
    body: firstText?.text || row.body || null,
    media_url: firstMedia?.url || row.media_url || null,
    block_count: blocks.length,
  };
  if (fullBlocks) {
    base.blocks = blocks;
  } else {
    base.preview_block = blocks[0] || null;
  }
  return base;
}

async function assertMediaForBlock(conn, userId, block) {
  if (block.type === 'text') return null;
  let mediaId = block.media_id || null;

  if (!mediaId && block.url) {
    const mediaType = expectedMediaType(block.type);
    const [ins] = await conn.execute(
      `INSERT INTO media_recordings (user_id, media_type, title, url, purpose)
       VALUES (?, ?, ?, ?, 'journal')`,
      [userId, mediaType, block.title || null, block.url]
    );
    mediaId = ins.insertId;
  }

  const [rows] = await conn.execute(
    `SELECT id, user_id, media_type, purpose, journal_entry_id FROM media_recordings WHERE id = ?`,
    [mediaId]
  );
  const media = rows[0];
  if (!media || Number(media.user_id) !== Number(userId)) {
    const err = new Error(`media_id ${mediaId} not found`);
    err.status = 422;
    throw err;
  }
  const expected = expectedMediaType(block.type);
  if (media.media_type !== expected) {
    const err = new Error(
      `${block.type} block requires media_type=${expected} (got ${media.media_type} for media_id ${mediaId})`
    );
    err.status = 422;
    throw err;
  }
  return mediaId;
}

async function replaceBlocks(conn, entryId, userId, blocks, requestedType) {
  // Detach previously attached media (return to unattached pool for 24h cleanup).
  await conn.execute(
    `UPDATE media_recordings SET journal_entry_id = NULL
     WHERE journal_entry_id = ? AND user_id = ?`,
    [entryId, userId]
  );
  await conn.execute(`DELETE FROM journal_blocks WHERE journal_entry_id = ?`, [entryId]);

  const saved = [];
  let order = 1;
  for (const raw of blocks) {
    const mediaId = await assertMediaForBlock(conn, userId, raw);
    if (mediaId) {
      await conn.execute(
        `UPDATE media_recordings SET journal_entry_id = ?, purpose = 'journal' WHERE id = ? AND user_id = ?`,
        [entryId, mediaId, userId]
      );
    }
    const [ins] = await conn.execute(
      `INSERT INTO journal_blocks (journal_entry_id, type, sort_order, text, media_id)
       VALUES (?, ?, ?, ?, ?)`,
      [entryId, raw.type, order, raw.type === 'text' ? String(raw.text).trim() : null, mediaId]
    );
    saved.push({ id: ins.insertId, type: raw.type, order, text: raw.text, media_id: mediaId });
    order += 1;
  }

  const firstText = saved.find((b) => b.type === 'text');
  let firstMediaUrl = null;
  if (saved.some((b) => b.media_id)) {
    const firstMedia = saved.find((b) => b.media_id);
    const [mrows] = await conn.execute(`SELECT url FROM media_recordings WHERE id = ?`, [firstMedia.media_id]);
    firstMediaUrl = mrows[0]?.url || null;
  }
  const entryType = inferEntryType(requestedType, saved);
  await conn.execute(
    `UPDATE journal_entries SET body = ?, media_url = ?, entry_type = ? WHERE id = ?`,
    [firstText ? String(firstText.text).trim() : null, firstMediaUrl, entryType, entryId]
  );
  return saved;
}

async function validatePrompt(promptId) {
  if (!promptId) return;
  const [prompt] = await query(`SELECT id FROM journal_prompts WHERE id = :id AND is_active = 1`, { id: promptId });
  if (!prompt) {
    const err = new Error('Journal prompt not found or inactive');
    err.status = 404;
    throw err;
  }
}

const getPrompt = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  const loop = String(req.query.loop ?? 'true').toLowerCase() !== 'false';
  const prompts = await query(
    `SELECT id, text_en, text_ar, sort_order
     FROM journal_prompts WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`
  );
  if (!prompts.length) return ok(res, { prompt: null, remaining: 0, total: 0 });
  const answered = await query(
    `SELECT DISTINCT prompt_id AS id FROM journal_entries WHERE user_id = :uid AND prompt_id IS NOT NULL`,
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
  const p = req.body || {};
  try {
    await validatePrompt(p.prompt_id || null);
  } catch (err) {
    return fail(res, err.message, err.status || 400);
  }

  const blocks = p.blocks && p.blocks.length ? p.blocks : legacyToBlocks(p);
  if (!blocks.length) return fail(res, 'Provide blocks[] or body/media', 422);

  const entryDate = normalizeEntryDate(p.entry_date || new Date());
  let entryId;
  try {
    entryId = await withTransaction(async (conn) => {
      const [ins] = await conn.execute(
        `INSERT INTO journal_entries
          (user_id, prompt_id, entry_type, title, body, mood_tag, media_url, is_pinned, entry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          p.prompt_id || null,
          p.entry_type || 'text',
          p.title || null,
          p.body || null,
          p.mood_tag || null,
          p.media_url || null,
          p.is_pinned ? 1 : 0,
          toMysqlDateTime(entryDate),
        ]
      );
      await replaceBlocks(conn, ins.insertId, req.user.id, blocks, p.entry_type || null);
      return ins.insertId;
    });
  } catch (err) {
    return fail(res, err.message || 'Could not create journal entry', err.status || 400);
  }

  const [row] = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: entryId });
  return ok(res, { entry: await formatEntry(row) }, 'Journal entry created', 201);
});

const list = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const params = { uid: req.user.id };
  let sql = `SELECT e.* FROM journal_entries e WHERE e.user_id = :uid`;
  if (q) {
    sql += ` AND (
      e.title LIKE :q OR e.body LIKE :q
      OR EXISTS (
        SELECT 1 FROM journal_blocks jb
        WHERE jb.journal_entry_id = e.id AND jb.type = 'text' AND jb.text LIKE :q
      )
    )`;
    params.q = `%${q}%`;
  }
  if (req.query.prompt_id) {
    sql += ` AND e.prompt_id = :prompt_id`;
    params.prompt_id = Number(req.query.prompt_id);
  }
  sql += ` ORDER BY e.is_pinned DESC, e.entry_date DESC, e.id DESC LIMIT 100`;
  const rows = await query(sql, params);
  const entries = [];
  for (const row of rows) {
    entries.push(await formatEntry(row, { fullBlocks: false }));
  }
  return ok(res, { entries });
});

const getOne = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Entry not found', 404);
  return ok(res, { entry: await formatEntry(rows[0]) });
});

const update = asyncHandler(async (req, res) => {
  const [existing] = await query(`SELECT * FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing) return fail(res, 'Entry not found', 404);
  const p = req.body || {};

  if (Object.prototype.hasOwnProperty.call(p, 'prompt_id')) {
    try {
      await validatePrompt(p.prompt_id || null);
    } catch (err) {
      return fail(res, err.message, err.status || 400);
    }
  }

  const entryDate = Object.prototype.hasOwnProperty.call(p, 'entry_date')
    ? normalizeEntryDate(p.entry_date)
    : null;

  try {
    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE journal_entries SET
           entry_type = COALESCE(?, entry_type),
           title = COALESCE(?, title),
           body = COALESCE(?, body),
           mood_tag = COALESCE(?, mood_tag),
           media_url = COALESCE(?, media_url),
           is_pinned = COALESCE(?, is_pinned),
           entry_date = COALESCE(?, entry_date),
           prompt_id = COALESCE(?, prompt_id)
         WHERE id = ?`,
        [
          p.entry_type ?? null,
          p.title !== undefined ? p.title || null : null,
          p.body !== undefined ? p.body || null : null,
          p.mood_tag !== undefined ? p.mood_tag || null : null,
          p.media_url !== undefined ? p.media_url || null : null,
          p.is_pinned === undefined ? null : p.is_pinned ? 1 : 0,
          entryDate ? toMysqlDateTime(entryDate) : null,
          Object.prototype.hasOwnProperty.call(p, 'prompt_id') ? p.prompt_id || null : null,
          req.params.id,
        ]
      );

      // Only replace all blocks when the client explicitly sends blocks[] (or legacy media/notes arrays).
      if (Array.isArray(p.blocks)) {
        if (!p.blocks.length) {
          const err = new Error('blocks must contain 1 to 50 items');
          err.status = 422;
          throw err;
        }
        await replaceBlocks(conn, Number(req.params.id), req.user.id, p.blocks, p.entry_type || existing.entry_type);
      } else if (
        Object.prototype.hasOwnProperty.call(p, 'media') ||
        Object.prototype.hasOwnProperty.call(p, 'media_ids') ||
        Object.prototype.hasOwnProperty.call(p, 'notes')
      ) {
        const blocks = legacyToBlocks(p);
        if (blocks.length) {
          await replaceBlocks(conn, Number(req.params.id), req.user.id, blocks, p.entry_type || existing.entry_type);
        }
      } else if (Object.prototype.hasOwnProperty.call(p, 'body')) {
        // Legacy clients PUT body without blocks[] — keep media blocks, sync first text block.
        const text = p.body ? String(p.body).trim() : '';
        const [textBlocks] = await conn.execute(
          `SELECT id FROM journal_blocks WHERE journal_entry_id = ? AND type = 'text' ORDER BY sort_order ASC, id ASC LIMIT 1`,
          [req.params.id]
        );
        if (textBlocks[0]) {
          await conn.execute(`UPDATE journal_blocks SET text = ? WHERE id = ?`, [text || null, textBlocks[0].id]);
        } else if (text) {
          const [maxOrder] = await conn.execute(
            `SELECT COALESCE(MAX(sort_order), 0) AS m FROM journal_blocks WHERE journal_entry_id = ?`,
            [req.params.id]
          );
          await conn.execute(
            `INSERT INTO journal_blocks (journal_entry_id, type, sort_order, text) VALUES (?, 'text', ?, ?)`,
            [req.params.id, Number(maxOrder[0].m) + 1, text]
          );
        }
      }
    });
  } catch (err) {
    return fail(res, err.message || 'Could not update journal entry', err.status || 400);
  }

  // Fix prompt_id nulling: COALESCE won't clear. Handle explicit null.
  if (Object.prototype.hasOwnProperty.call(p, 'prompt_id') && (p.prompt_id === null || p.prompt_id === '')) {
    await query(`UPDATE journal_entries SET prompt_id = NULL WHERE id = :id`, { id: req.params.id });
  }

  const [row] = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: req.params.id });
  return ok(res, { entry: await formatEntry(row) }, 'Updated');
});

const remove = asyncHandler(async (req, res) => {
  const [existing] = await query(`SELECT id FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing) return fail(res, 'Entry not found', 404);

  const mediaRows = await query(
    `SELECT id, user_id, file_path, thumbnail_path FROM media_recordings
     WHERE journal_entry_id = :eid AND user_id = :uid`,
    { eid: req.params.id, uid: req.user.id }
  );

  await query(`DELETE FROM journal_entries WHERE id = :id`, { id: req.params.id });
  for (const m of mediaRows) {
    await deleteRecordingRow(m).catch(() => {});
  }
  return ok(res, null, 'Deleted');
});

// --- Admin prompts ---

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
