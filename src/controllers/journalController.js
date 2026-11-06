const Joi = require('joi');
const multer = require('multer');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

const MEDIA_TYPES = ['audio', 'image', 'video', 'file'];
const MEDIA_MIMES = {
  audio: /^audio\//,
  image: /^image\//,
  video: /^video\//,
  file: /.+/,
};
const MAX_MEDIA_PER_ENTRY = 10;
const MEDIA_COLUMNS = 'id, entry_id, user_id, media_type, title, url, file_mime, sort_order, created_at';

const mediaItemSchema = Joi.object({
  id: Joi.number().integer().positive(),
  type: Joi.string().valid(...MEDIA_TYPES),
  media_type: Joi.string().valid(...MEDIA_TYPES),
  url: Joi.string().uri().allow('', null),
  title: Joi.string().max(200).allow('', null),
  sort_order: Joi.number().integer().min(0),
}).or('id', 'url');

const entrySchema = Joi.object({
  entry_type: Joi.string()
    .valid('text', 'audio', 'image', 'video', 'gratitude', 'mixed')
    .default('text'),
  title: Joi.string().allow('', null),
  body: Joi.string().allow('', null),
  mood_tag: Joi.string().allow('', null),
  // Legacy single URL — still accepted; becomes the first media item when `media` is empty.
  media_url: Joi.string().uri().allow('', null),
  // Multiple attachments: uploaded media ids and/or external URLs.
  media: Joi.array().items(mediaItemSchema).max(MAX_MEDIA_PER_ENTRY).default([]),
  media_ids: Joi.array().items(Joi.number().integer().positive()).max(MAX_MEDIA_PER_ENTRY),
  is_pinned: Joi.boolean().default(false),
  entry_date: Joi.date().iso().default(() => new Date().toISOString().slice(0, 10)),
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

function publicMedia(row) {
  if (!row) return null;
  return {
    id: row.id,
    entry_id: row.entry_id,
    media_type: row.media_type,
    type: row.media_type,
    title: row.title,
    url: row.url,
    file_mime: row.file_mime,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

function inferEntryType(requested, mediaRows) {
  if (requested && requested !== 'text' && requested !== 'mixed') return requested;
  if (!mediaRows.length) return requested || 'text';
  const types = [...new Set(mediaRows.map((m) => m.media_type))];
  if (types.length > 1) return 'mixed';
  if (types[0] === 'audio') return 'audio';
  if (types[0] === 'image') return 'image';
  if (types[0] === 'video') return 'video';
  return 'mixed';
}

async function loadMediaForEntries(entryIds) {
  if (!entryIds.length) return new Map();
  const rows = await query(
    `SELECT ${MEDIA_COLUMNS} FROM journal_media
     WHERE entry_id IN (${entryIds.map((_, i) => `:e${i}`).join(',')})
     ORDER BY sort_order ASC, id ASC`,
    Object.fromEntries(entryIds.map((id, i) => [`e${i}`, id]))
  );
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.entry_id) || [];
    list.push(publicMedia(row));
    map.set(row.entry_id, list);
  }
  return map;
}

async function formatEntry(row) {
  if (!row) return null;
  const mediaMap = await loadMediaForEntries([row.id]);
  const media = mediaMap.get(row.id) || [];
  // Backward compat: if no child rows but legacy media_url exists, expose it once.
  if (!media.length && row.media_url) {
    media.push({
      id: null,
      entry_id: row.id,
      media_type: row.entry_type === 'audio' || row.entry_type === 'image' || row.entry_type === 'video' ? row.entry_type : 'file',
      type: row.entry_type === 'audio' || row.entry_type === 'image' || row.entry_type === 'video' ? row.entry_type : 'file',
      title: null,
      url: row.media_url,
      file_mime: null,
      sort_order: 0,
      created_at: row.created_at,
    });
  }
  return { ...row, media, media_count: media.length };
}

function collectMediaInput(p) {
  const items = [];
  for (const id of p.media_ids || []) {
    items.push({ id: Number(id) });
  }
  for (const m of p.media || []) {
    items.push({
      id: m.id ? Number(m.id) : undefined,
      type: m.type || m.media_type || undefined,
      url: m.url || undefined,
      title: m.title || undefined,
      sort_order: m.sort_order,
    });
  }
  if ((!items.length || items.every((i) => !i.url && !i.id)) && p.media_url) {
    items.push({ url: p.media_url, type: p.entry_type === 'audio' || p.entry_type === 'image' || p.entry_type === 'video' ? p.entry_type : 'file' });
  }
  // Dedupe by id
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item.id) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    out.push(item);
  }
  return out.slice(0, MAX_MEDIA_PER_ENTRY);
}

async function attachMediaToEntry(entryId, userId, mediaInput, requestedType = null) {
  const attached = [];
  let order = 0;
  for (const item of mediaInput) {
    if (item.id) {
      const [row] = await query(
        `SELECT ${MEDIA_COLUMNS} FROM journal_media
         WHERE id = :id AND user_id = :uid AND (entry_id IS NULL OR entry_id = :eid)`,
        { id: item.id, uid: userId, eid: entryId }
      );
      if (!row) {
        const err = new Error(`Journal media ${item.id} not found`);
        err.status = 404;
        throw err;
      }
      await query(
        `UPDATE journal_media SET entry_id = :eid, sort_order = :ord,
           title = COALESCE(:title, title)
         WHERE id = :id`,
        { eid: entryId, ord: item.sort_order ?? order, title: item.title || null, id: item.id }
      );
      const [fresh] = await query(`SELECT ${MEDIA_COLUMNS} FROM journal_media WHERE id = :id`, { id: item.id });
      attached.push(fresh);
    } else if (item.url) {
      const type = item.type || 'file';
      if (!MEDIA_TYPES.includes(type)) {
        const err = new Error(`media type must be one of: ${MEDIA_TYPES.join(', ')}`);
        err.status = 422;
        throw err;
      }
      const result = await query(
        `INSERT INTO journal_media (entry_id, user_id, media_type, title, url, sort_order)
         VALUES (:eid, :uid, :type, :title, :url, :ord)`,
        {
          eid: entryId,
          uid: userId,
          type,
          title: item.title || null,
          url: item.url,
          ord: item.sort_order ?? order,
        }
      );
      const [fresh] = await query(`SELECT ${MEDIA_COLUMNS} FROM journal_media WHERE id = :id`, {
        id: result.insertId,
      });
      attached.push(fresh);
    }
    order += 1;
  }

  const primaryUrl = attached[0]?.url || null;
  const entryType = inferEntryType(requestedType, attached);
  await query(`UPDATE journal_entries SET media_url = :url, entry_type = :etype WHERE id = :id`, {
    url: primaryUrl,
    etype: entryType === 'text' && requestedType === 'gratitude' ? 'gratitude' : entryType,
    id: entryId,
  });
  return attached.map(publicMedia);
}

/**
 * GET /journals/prompt
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
  const p = req.body || {};
  let promptId = p.prompt_id || null;
  if (promptId) {
    const [prompt] = await query(
      `SELECT id FROM journal_prompts WHERE id = :id AND is_active = 1`,
      { id: promptId }
    );
    if (!prompt) return fail(res, 'Journal prompt not found or inactive', 404);
  }

  const mediaInput = collectMediaInput(p);
  const entryType = p.entry_type || 'text';

  const result = await query(
    `INSERT INTO journal_entries
      (user_id, prompt_id, entry_type, title, body, mood_tag, media_url, is_pinned, entry_date)
     VALUES (:uid, :prompt_id, :entry_type, :title, :body, :mood_tag, :media_url, :is_pinned, :entry_date)`,
    {
      uid: req.user.id,
      prompt_id: promptId,
      entry_type: entryType,
      title: p.title || null,
      body: p.body || null,
      mood_tag: p.mood_tag || null,
      media_url: p.media_url || null,
      is_pinned: p.is_pinned ? 1 : 0,
      entry_date: p.entry_date,
    }
  );

  try {
    if (mediaInput.length) {
      await attachMediaToEntry(result.insertId, req.user.id, mediaInput, entryType);
    }
  } catch (err) {
    await query(`DELETE FROM journal_entries WHERE id = :id`, { id: result.insertId }).catch(() => {});
    return fail(res, err.message || 'Could not attach media', err.status || 400);
  }

  const [row] = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: result.insertId });
  return ok(res, { entry: await formatEntry(row) }, 'Journal entry created', 201);
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
  const mediaMap = await loadMediaForEntries(rows.map((r) => r.id));
  const entries = rows.map((row) => {
    const media = mediaMap.get(row.id) || [];
    if (!media.length && row.media_url) {
      media.push({
        id: null,
        entry_id: row.id,
        media_type: 'file',
        type: 'file',
        title: null,
        url: row.media_url,
        file_mime: null,
        sort_order: 0,
        created_at: row.created_at,
      });
    }
    return { ...row, media, media_count: media.length };
  });
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
  const existing = await query(`SELECT id FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing.length) return fail(res, 'Entry not found', 404);
  const p = req.body || {};
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

  const mediaInput = collectMediaInput(p);
  const replacingMedia =
    Object.prototype.hasOwnProperty.call(p, 'media') ||
    Object.prototype.hasOwnProperty.call(p, 'media_ids') ||
    Object.prototype.hasOwnProperty.call(p, 'media_url');
  if (replacingMedia) {
    // Detach previous rows (keep uploaded blobs as orphans only if not re-attached).
    await query(`UPDATE journal_media SET entry_id = NULL WHERE entry_id = :eid AND user_id = :uid`, {
      eid: req.params.id,
      uid: req.user.id,
    });
    try {
      await attachMediaToEntry(Number(req.params.id), req.user.id, mediaInput, p.entry_type || null);
    } catch (err) {
      return fail(res, err.message || 'Could not attach media', err.status || 400);
    }
  }

  const [row] = await query(`SELECT * FROM journal_entries WHERE id = :id`, { id: req.params.id });
  return ok(res, { entry: await formatEntry(row) }, 'Updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM journal_entries WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Entry not found', 404);
  return ok(res, null, 'Deleted');
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: MAX_MEDIA_PER_ENTRY },
});

function detectMediaType(mimetype, hint) {
  if (hint && MEDIA_TYPES.includes(hint) && hint !== 'file') {
    if (MEDIA_MIMES[hint].test(mimetype) || hint === 'file') return hint;
  }
  if (/^audio\//.test(mimetype)) return 'audio';
  if (/^image\//.test(mimetype)) return 'image';
  if (/^video\//.test(mimetype)) return 'video';
  return 'file';
}

/**
 * POST /journals/media/upload
 * multipart field `file` (single) or `files` (up to 10).
 * Optional: media_type / title / entry_id (attach immediately).
 */
const uploadMedia = (req, res, next) =>
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: MAX_MEDIA_PER_ENTRY },
  ])(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'Each file must be 40 MB or smaller', 422);
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return fail(res, `Upload at most ${MAX_MEDIA_PER_ENTRY} files`, 422);
      }
      return next(err);
    }
    try {
      const single = req.files?.file || [];
      const many = req.files?.files || [];
      const files = [...single, ...many];
      if (!files.length) return fail(res, 'Attach file(s) as "file" or "files"', 422);

      const entryId = req.body.entry_id ? Number(req.body.entry_id) : null;
      if (entryId) {
        const [entry] = await query(`SELECT id FROM journal_entries WHERE id = :id AND user_id = :uid`, {
          id: entryId,
          uid: req.user.id,
        });
        if (!entry) return fail(res, 'Journal entry not found', 404);
      }

      const hint = String(req.body.media_type || req.body.type || '').toLowerCase() || null;
      const titleBase = (req.body.title || '').slice(0, 200) || null;
      const saved = [];

      let sortBase = 0;
      if (entryId) {
        const [agg] = await query(
          `SELECT COALESCE(MAX(sort_order), -1) AS m FROM journal_media WHERE entry_id = :eid`,
          { eid: entryId }
        );
        sortBase = Number(agg?.m ?? -1) + 1;
      }

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const mediaType = detectMediaType(file.mimetype, hint);
        if (hint && MEDIA_MIMES[hint] && hint !== 'file' && !MEDIA_MIMES[hint].test(file.mimetype)) {
          return fail(res, `File "${file.originalname}" is not a valid ${hint}`, 422);
        }
        const result = await query(
          `INSERT INTO journal_media
             (entry_id, user_id, media_type, title, url, file_mime, file_data, sort_order)
           VALUES (:eid, :uid, :type, :title, '', :mime, :data, :ord)`,
          {
            eid: entryId,
            uid: req.user.id,
            type: mediaType,
            title: titleBase || (file.originalname || '').slice(0, 200) || null,
            mime: (file.mimetype || 'application/octet-stream').slice(0, 80),
            data: file.buffer,
            ord: sortBase + i,
          }
        );
        const url = `${env.app.url}/api/v1/journals/media/${result.insertId}/file`;
        await query(`UPDATE journal_media SET url = :url WHERE id = :id`, { url, id: result.insertId });
        const [row] = await query(`SELECT ${MEDIA_COLUMNS} FROM journal_media WHERE id = :id`, {
          id: result.insertId,
        });
        saved.push(publicMedia(row));
      }

      if (entryId && saved.length) {
        const [first] = await query(
          `SELECT url FROM journal_media WHERE entry_id = :eid ORDER BY sort_order ASC, id ASC LIMIT 1`,
          { eid: entryId }
        );
        if (first?.url) {
          await query(`UPDATE journal_entries SET media_url = :url WHERE id = :id AND (media_url IS NULL OR media_url = '')`, {
            url: first.url,
            id: entryId,
          });
        }
        const attached = await query(
          `SELECT media_type FROM journal_media WHERE entry_id = :eid`,
          { eid: entryId }
        );
        const types = [...new Set(attached.map((m) => m.media_type))];
        if (types.length > 1) {
          await query(`UPDATE journal_entries SET entry_type = 'mixed' WHERE id = :id`, { id: entryId });
        } else if (types[0] === 'audio' || types[0] === 'image' || types[0] === 'video') {
          await query(
            `UPDATE journal_entries SET entry_type = :t WHERE id = :id AND entry_type IN ('text','mixed')`,
            { t: types[0], id: entryId }
          );
        }
      }

      return ok(
        res,
        { media: saved, media_ids: saved.map((m) => m.id) },
        saved.length === 1 ? 'Media uploaded' : 'Media uploaded',
        201
      );
    } catch (e) {
      return next(e);
    }
  });

/** GET /journals/media/:id/file — owner-only binary stream */
const getMediaFile = asyncHandler(async (req, res) => {
  const [row] = await query(
    `SELECT file_mime, file_data FROM journal_media WHERE id = :id AND user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!row || !row.file_data) return fail(res, 'File not found', 404);
  res.set('Content-Type', row.file_mime || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  return res.send(row.file_data);
});

/** DELETE /journals/media/:id — remove one attachment */
const removeMedia = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM journal_media WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Media not found', 404);
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
  uploadMedia,
  getMediaFile,
  removeMedia,
  listPromptsAdmin,
  createPromptAdmin,
  updatePromptAdmin,
};
