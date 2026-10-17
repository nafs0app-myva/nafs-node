const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const consentsSchema = Joi.object({
  consents: Joi.array()
    .items(Joi.object({ consent_key: Joi.string().required(), enabled: Joi.boolean().required() }))
    .min(1)
    .required(),
});

const exportSchema = Joi.object({
  format: Joi.string().valid('pdf', 'json', 'zip').default('pdf'),
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

const listMedia = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM media_recordings WHERE user_id = :uid ORDER BY id DESC`,
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
  const rows = await query(`SELECT * FROM media_recordings WHERE id = :id`, { id: result.insertId });
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

const requestExport = asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO data_export_requests (user_id, format, include_flags, status, download_url)
     VALUES (:uid, :format, :flags, 'ready', :url)`,
    {
      uid: req.user.id,
      format: req.body.format,
      flags: JSON.stringify(req.body.include_flags || {}),
      url: `https://nafs.app/exports/mock-${Date.now()}.${req.body.format}`,
    }
  );
  const rows = await query(`SELECT * FROM data_export_requests WHERE id = :id`, { id: result.insertId });
  return ok(res, { export: rows[0] }, 'Export ready', 201);
});

const listExports = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM data_export_requests WHERE user_id = :uid ORDER BY id DESC`,
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
  deleteMedia,
  requestExport,
  listExports,
  retentionPolicy,
};
