const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const multer = require('multer');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const {
  SIZE_LIMITS,
  ensureUserDir,
  saveUploadedFile,
  removeMediaFiles,
  sendMediaContent,
  filePathFor,
} = require('../services/mediaStorage');

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
  purpose: Joi.string().valid('recording', 'journal').default('recording'),
});

const EXPORT_COLUMNS = 'id, user_id, format, include_flags, status, download_url, file_name, created_at';
const MEDIA_COLUMNS =
  'id, user_id, media_type, title, url, duration_seconds, file_mime, thumbnail_url, purpose, journal_entry_id, created_at';
const MEDIA_MIMES = { audio: /^audio\//, photo: /^image\//, video: /^video\// };

/** True when the user has switched [key] on; [fallback] applies before they ever saved it. */
async function consentEnabled(userId, key, fallback = false) {
  const [row] = await query(`SELECT enabled FROM user_consents WHERE user_id = :uid AND consent_key = :key`, {
    uid: userId,
    key,
  });
  return row ? !!row.enabled : fallback;
}

function publicRecording(row) {
  if (!row) return null;
  return {
    id: row.id,
    media_type: row.media_type,
    title: row.title,
    url: row.url,
    duration_seconds: row.duration_seconds,
    file_mime: row.file_mime,
    thumbnail_url: row.thumbnail_url || null,
    purpose: row.purpose || 'recording',
    journal_entry_id: row.journal_entry_id || null,
    created_at: row.created_at,
  };
}

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

// Voice & Photo Recordings list — journal-purpose media is excluded.
const listMedia = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT ${MEDIA_COLUMNS} FROM media_recordings
     WHERE user_id = :uid AND purpose = 'recording'
     ORDER BY id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { recordings: rows.map(publicRecording) });
});

const addMedia = asyncHandler(async (req, res) => {
  const p = req.body;
  const purpose = p.purpose === 'journal' ? 'journal' : 'recording';
  const result = await query(
    `INSERT INTO media_recordings (user_id, media_type, title, url, duration_seconds, purpose)
     VALUES (:uid, :media_type, :title, :url, :duration_seconds, :purpose)`,
    {
      uid: req.user.id,
      media_type: p.media_type,
      title: p.title || null,
      url: p.url,
      duration_seconds: p.duration_seconds ?? null,
      purpose,
    }
  );
  const [row] = await query(`SELECT ${MEDIA_COLUMNS} FROM media_recordings WHERE id = :id`, { id: result.insertId });
  return ok(res, { recording: publicRecording(row) }, 'Saved', 201);
});

async function deleteRecordingRow(row) {
  if (!row) return;
  await removeMediaFiles(row.user_id, row.id);
  await query(`DELETE FROM media_recordings WHERE id = :id`, { id: row.id });
}

const deleteMedia = asyncHandler(async (req, res) => {
  const [row] = await query(
    `SELECT id, user_id, file_path, thumbnail_path FROM media_recordings WHERE id = :id AND user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!row) return fail(res, 'Recording not found', 404);
  await deleteRecordingRow(row);
  return ok(res, null, 'Deleted');
});

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const dir = await ensureUserDir(req.user.id);
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname || '')}`;
      cb(null, `tmp-${safe}`);
    },
  }),
  limits: { fileSize: SIZE_LIMITS.video, files: 2 },
});

/**
 * POST /privacy/media/upload
 * multipart: file (required), optional thumbnail, media_type, title, duration_seconds, purpose
 */
const uploadMedia = (req, res, next) =>
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ])(req, res, async (err) => {
    const cleanupTmp = async () => {
      for (const list of Object.values(req.files || {})) {
        for (const f of list || []) {
          if (f?.path) await fs.promises.unlink(f.path).catch(() => {});
        }
      }
    };
    if (err) {
      await cleanupTmp();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(res, 'File exceeds the maximum allowed size (video 100 MB / audio 25 MB / photo 10 MB)', 422);
      }
      return next(err);
    }
    try {
      const file = req.files?.file?.[0];
      const thumb = req.files?.thumbnail?.[0];
      const type = String(req.body.media_type || '').toLowerCase();
      const purpose = String(req.body.purpose || 'recording').toLowerCase() === 'journal' ? 'journal' : 'recording';

      if (!file) {
        await cleanupTmp();
        return fail(res, 'Attach the file as the "file" field', 422);
      }
      if (!MEDIA_MIMES[type]) {
        await cleanupTmp();
        return fail(res, 'media_type must be audio, photo or video', 422);
      }
      if (!MEDIA_MIMES[type].test(file.mimetype)) {
        await cleanupTmp();
        return fail(res, `File is not a valid ${type}`, 422);
      }
      const limit = SIZE_LIMITS[type];
      if (file.size > limit) {
        await cleanupTmp();
        const mb = Math.round(limit / (1024 * 1024));
        return fail(res, `${type} files must be ${mb} MB or smaller`, 422);
      }
      if (type === 'photo' && purpose !== 'journal' && !(await consentEnabled(req.user.id, 'facial_emotion_cache'))) {
        await cleanupTmp();
        return fail(res, 'Turn on facial emotion caching before storing photos', 403);
      }
      // Journal photos skip the facial-emotion consent gate (composer attachments).
      if (type === 'photo' && purpose === 'journal') {
        // allowed
      }

      const duration = Number.parseInt(req.body.duration_seconds, 10);
      const result = await query(
        `INSERT INTO media_recordings
          (user_id, media_type, title, url, duration_seconds, file_mime, purpose)
         VALUES (:uid, :type, :title, '', :duration, :mime, :purpose)`,
        {
          uid: req.user.id,
          type,
          title: (req.body.title || file.originalname || '').slice(0, 160) || null,
          duration: Number.isFinite(duration) ? duration : null,
          mime: (file.mimetype || 'application/octet-stream').slice(0, 80),
          purpose,
        }
      );
      const id = result.insertId;
      const storedPath = await saveUploadedFile(req.user.id, id, file.path, 'file');
      let thumbnailUrl = null;
      let thumbnailPath = null;
      if (thumb) {
        if (!/^image\//.test(thumb.mimetype)) {
          await fs.promises.unlink(thumb.path).catch(() => {});
        } else {
          thumbnailPath = await saveUploadedFile(req.user.id, id, thumb.path, 'thumb');
          thumbnailUrl = `${env.app.url}/api/v1/privacy/media/${id}/thumbnail`;
        }
      }
      const url = `${env.app.url}/api/v1/privacy/media/${id}/file`;
      await query(
        `UPDATE media_recordings
         SET url = :url, file_path = :path, thumbnail_path = :tpath, thumbnail_url = :turl
         WHERE id = :id`,
        { url, path: storedPath, tpath: thumbnailPath, turl: thumbnailUrl, id }
      );
      const [row] = await query(`SELECT ${MEDIA_COLUMNS} FROM media_recordings WHERE id = :id`, { id });
      return ok(res, { recording: publicRecording(row) }, 'Saved', 201);
    } catch (e) {
      await cleanupTmp();
      return next(e);
    }
  });

async function loadOwnedMedia(id, userId) {
  const [row] = await query(
    `SELECT id, user_id, file_mime, file_data, file_path, thumbnail_path, thumbnail_url
     FROM media_recordings WHERE id = :id AND user_id = :uid`,
    { id, uid: userId }
  );
  return row || null;
}

const getMediaFile = asyncHandler(async (req, res) => {
  const row = await loadOwnedMedia(req.params.id, req.user.id);
  if (!row) return fail(res, 'File not found', 404);
  const sent = sendMediaContent(req, res, {
    mime: row.file_mime,
    filePath: row.file_path,
    buffer: row.file_data,
  });
  if (!sent) return fail(res, 'File not found', 404);
});

const getMediaThumbnail = asyncHandler(async (req, res) => {
  const row = await loadOwnedMedia(req.params.id, req.user.id);
  if (!row) return fail(res, 'Thumbnail not found', 404);
  const sent = sendMediaContent(req, res, {
    mime: 'image/jpeg',
    filePath: row.thumbnail_path,
    buffer: null,
  });
  if (!sent) return fail(res, 'Thumbnail not found', 404);
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
    const entries = await query(
      `SELECT id, entry_type, title, body, mood_tag, is_pinned, entry_date, created_at FROM journal_entries
       WHERE user_id = :uid AND is_locked = 0 ORDER BY id`,
      { uid }
    );
    const entryIds = entries.map((e) => e.id);
    let blocks = [];
    if (entryIds.length) {
      blocks = await query(
        `SELECT b.id, b.journal_entry_id, b.type, b.sort_order, b.text, b.media_id,
                m.url AS media_url, m.media_type, m.duration_seconds, m.thumbnail_url
         FROM journal_blocks b
         LEFT JOIN media_recordings m ON m.id = b.media_id
         WHERE b.journal_entry_id IN (${entryIds.map((_, i) => `:e${i}`).join(',')})
         ORDER BY b.journal_entry_id, b.sort_order`,
        Object.fromEntries(entryIds.map((id, i) => [`e${i}`, id]))
      );
    }
    const byEntry = new Map();
    for (const b of blocks) {
      const list = byEntry.get(b.journal_entry_id) || [];
      list.push({
        id: b.id,
        type: b.type,
        order: b.sort_order,
        text: b.text,
        media_id: b.media_id,
        url: b.media_url,
        duration_seconds: b.duration_seconds,
        thumbnail_url: b.thumbnail_url,
      });
      byEntry.set(b.journal_entry_id, list);
    }
    bundle.journal = entries.map((e) => ({ ...e, blocks: byEntry.get(e.id) || [] }));
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
      `SELECT id, media_type, title, url, duration_seconds, purpose, thumbnail_url, created_at
       FROM media_recordings WHERE user_id = :uid AND purpose = 'recording' ORDER BY id`,
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
  getMediaThumbnail,
  deleteMedia,
  deleteRecordingRow,
  downloadExport,
  consentEnabled,
  requestExport,
  listExports,
  retentionPolicy,
  publicRecording,
  MEDIA_COLUMNS,
};
