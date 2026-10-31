const Joi = require('joi');
const multer = require('multer');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

const consentsSchema = Joi.object({
  consents: Joi.array()
    .items(Joi.object({ consent_key: Joi.string().required(), enabled: Joi.boolean().required() }))
    .min(1)
    .required(),
});

const exportSchema = Joi.object({
  format: Joi.string().valid('json').default('json'),
  include_flags: Joi.object().default({}),
});

const mediaSchema = Joi.object({
  media_type: Joi.string().valid('audio', 'photo', 'video').required(),
  title: Joi.string().allow('', null),
  url: Joi.string().uri().required(),
  duration_seconds: Joi.number().integer().allow(null),
});

const listConsents = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT consent_key, enabled, updated_at FROM user_consents WHERE user_id = :uid`, {
    uid: req.user.id,
  });
  return ok(res, { consents: rows });
});

const updateConsents = asyncHandler(async (req, res) => {
  for (const c of req.body.consents) {
    await query(
      `INSERT INTO user_consents (user_id, consent_key, enabled)
       VALUES (:uid, :key, :enabled)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      { uid: req.user.id, key: c.consent_key, enabled: c.enabled ? 1 : 0 }
    );
  }
  return listConsents(req, res);
});

const EXPORT_COLUMNS = 'id, user_id, format, include_flags, status, download_url, file_name, created_at';
const MEDIA_COLUMNS = 'id, user_id, media_type, title, url, duration_seconds, file_mime, created_at';
const MEDIA_MIMES = { audio: /^audio\//, photo: /^image\//, video: /^video\// };

/** True when the user has switched [key] on; [fallback] applies before they ever saved it. */
async function consentEnabled(userId, key, fallback = false) {
  const [row] = await query(`SELECT enabled FROM user_consents WHERE user_id = :uid AND consent_key = :key`, {
    uid: userId,
    key,
  });
  return row ? !!row.enabled : fallback;
}

const listMedia = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT ${MEDIA_COLUMNS} FROM media_recordings WHERE user_id = :uid ORDER BY id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { recordings: rows });
});

const addMedia = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO media_recordings (user_id, media_type, title, url, duration_seconds)
     VALUES (:uid, :media_type, :title, :url, :duration_seconds)`,
    {
      uid: req.user.id,
      media_type: p.media_type,
      title: p.title || null,
      url: p.url,
      duration_seconds: p.duration_seconds ?? null,
    }
  );
  const rows = await query(`SELECT ${MEDIA_COLUMNS} FROM media_recordings WHERE id = :id`, { id: result.insertId });
  return ok(res, { recording: rows[0] }, 'Saved', 201);
});

const deleteMedia = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM media_recordings WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Recording not found', 404);
  return ok(res, null, 'Deleted');
});

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file');

// POST /privacy/media/upload  (multipart: `file`, `media_type`, optional `title`, `duration_seconds`)
const uploadMedia = (req, res, next) =>
  mediaUpload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'File must be 15 MB or smaller', 422);
      return next(err);
    }
    try {
      const type = req.body.media_type;
      if (!req.file) return fail(res, 'Attach the file as the "file" field', 422);
      if (!MEDIA_MIMES[type]) return fail(res, 'media_type must be audio, photo or video', 422);
      if (!MEDIA_MIMES[type].test(req.file.mimetype)) return fail(res, `File is not a valid ${type}`, 422);
      if (type === 'photo' && !(await consentEnabled(req.user.id, 'facial_emotion_cache'))) {
        return fail(res, 'Turn on facial emotion caching before storing photos', 403);
      }
      const duration = Number.parseInt(req.body.duration_seconds, 10);
      const result = await query(
        `INSERT INTO media_recordings (user_id, media_type, title, url, duration_seconds, file_mime, file_data)
         VALUES (:uid, :type, :title, '', :duration, :mime, :data)`,
        {
          uid: req.user.id,
          type,
          title: (req.body.title || req.file.originalname || '').slice(0, 160) || null,
          duration: Number.isFinite(duration) ? duration : null,
          mime: req.file.mimetype.slice(0, 80),
          data: req.file.buffer,
        }
      );
      const url = `${env.app.url}/api/v1/privacy/media/${result.insertId}/file`;
      await query(`UPDATE media_recordings SET url = :url WHERE id = :id`, { url, id: result.insertId });
      const rows = await query(`SELECT ${MEDIA_COLUMNS} FROM media_recordings WHERE id = :id`, { id: result.insertId });
      return ok(res, { recording: rows[0] }, 'Saved', 201);
    } catch (e) {
      return next(e);
    }
  });

// GET /privacy/media/:id/file — the owner's uploaded file
const getMediaFile = asyncHandler(async (req, res) => {
  const [row] = await query(`SELECT file_mime, file_data FROM media_recordings WHERE id = :id AND user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!row || !row.file_data) return fail(res, 'File not found', 404);
  res.set('Content-Type', row.file_mime || 'application/octet-stream');
  return res.send(row.file_data);
});

/** Builds the per-user data bundle for the categories switched on in [flags]. */
async function buildExportBundle(user, flags) {
  const uid = user.id;
  const bundle = {
    generated_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    consents: await query(`SELECT consent_key, enabled, updated_at FROM user_consents WHERE user_id = :uid`, { uid }),
  };
  if (flags.journal) {
    bundle.journal = await query(
      `SELECT id, entry_type, title, body, mood_tag, is_pinned, entry_date, created_at FROM journal_entries
       WHERE user_id = :uid AND is_locked = 0 ORDER BY id`,
      { uid }
    );
  }
  if (flags.mood_checkins) {
    bundle.mood_checkins = await query(
      `SELECT id, mood, intensity, note, tags, checked_in_at FROM mood_checkins WHERE user_id = :uid ORDER BY id`,
      { uid }
    );
  }
  if (flags.ai_transcripts) {
    bundle.chat_messages = await query(
      `SELECT m.id, m.thread_id, m.sender_user_id, m.body, m.created_at FROM chat_messages m
       JOIN chat_threads t ON t.id = m.thread_id
       LEFT JOIN therapist_clients c ON c.id = t.client_id
       WHERE t.therapist_id = :uid OR c.client_user_id = :uid ORDER BY m.id`,
      { uid }
    );
  }
  if (flags.audio_photo) {
    bundle.recordings = await query(
      `SELECT id, media_type, title, url, duration_seconds, created_at FROM media_recordings WHERE user_id = :uid ORDER BY id`,
      { uid }
    );
  }
  if (flags.assessment_metrics) {
    bundle.assessments = await query(
      `SELECT id, assessment_type, status, score, summary, completed_at, created_at FROM assessments
       WHERE user_id = :uid ORDER BY id`,
      { uid }
    );
    const [goals] = await query(`SELECT goals, updated_at FROM user_goals WHERE user_id = :uid`, { uid });
    bundle.goals = goals || null;
  }
  return bundle;
}

const requestExport = asyncHandler(async (req, res) => {
  const flags = req.body.include_flags || {};
  if (!Object.values(flags).some(Boolean)) return fail(res, 'Select at least one category to export', 422);
  const bundle = await buildExportBundle(req.user, flags);
  const file = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
  const result = await query(
    `INSERT INTO data_export_requests (user_id, format, include_flags, status, file_name, file_mime, file_data)
     VALUES (:uid, 'json', :flags, 'ready', :name, 'application/json', :data)`,
    {
      uid: req.user.id,
      flags: JSON.stringify(flags),
      name: `nafs-export-${new Date().toISOString().slice(0, 10)}.json`,
      data: file,
    }
  );
  const url = `${env.app.url}/api/v1/privacy/exports/${result.insertId}/download`;
  await query(`UPDATE data_export_requests SET download_url = :url WHERE id = :id`, { url, id: result.insertId });
  const rows = await query(`SELECT ${EXPORT_COLUMNS} FROM data_export_requests WHERE id = :id`, { id: result.insertId });
  return ok(res, { export: rows[0] }, 'Export ready', 201);
});

// GET /privacy/exports/:id/download — the owner's generated archive
const downloadExport = asyncHandler(async (req, res) => {
  const [row] = await query(
    `SELECT file_name, file_mime, file_data FROM data_export_requests WHERE id = :id AND user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!row || !row.file_data) return fail(res, 'Export not found', 404);
  res.set('Content-Type', row.file_mime || 'application/json');
  res.set('Content-Disposition', `attachment; filename="${row.file_name || 'nafs-export.json'}"`);
  return res.send(row.file_data);
});

const listExports = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT ${EXPORT_COLUMNS} FROM data_export_requests WHERE user_id = :uid ORDER BY id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { exports: rows });
});

const retentionPolicy = asyncHandler(async (_req, res) => {
  return ok(res, {
    policy: {
      active_account_days: 365,
      ai_conversations_days: 180,
      voice_biometric_days: 90,
      inactive_archive_days: 730,
      immediate_deletion_supported: true,
    },
  });
});

module.exports = {
  consentsSchema,
  exportSchema,
  mediaSchema,
  listConsents,
  updateConsents,
  listMedia,
  addMedia,
  uploadMedia,
  getMediaFile,
  deleteMedia,
  downloadExport,
  consentEnabled,
  requestExport,
  listExports,
  retentionPolicy,
};
