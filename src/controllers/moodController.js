const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const checkinSchema = Joi.object({
  mood: Joi.string().required(),
  intensity: Joi.number().integer().min(1).max(10).allow(null),
  note: Joi.string().allow('', null),
  audio_url: Joi.string().uri().allow('', null),
  tags: Joi.array().items(Joi.string()).default([]),
});

const detectorSchema = Joi.object({
  detected_mood: Joi.string().required(),
  confidence: Joi.number().min(0).max(100).allow(null),
  consent_accepted: Joi.boolean().required(),
  image_url: Joi.string().uri().allow('', null),
  raw_payload: Joi.object().allow(null),
});

const createCheckin = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO mood_checkins (user_id, mood, intensity, note, audio_url, tags)
     VALUES (:uid, :mood, :intensity, :note, :audio_url, :tags)`,
    {
      uid: req.user.id,
      mood: p.mood,
      intensity: p.intensity ?? null,
      note: p.note || null,
      audio_url: p.audio_url || null,
      tags: JSON.stringify(p.tags || []),
    }
  );
  const rows = await query(`SELECT * FROM mood_checkins WHERE id = :id`, { id: result.insertId });
  return ok(res, { checkin: rows[0] }, 'Mood saved', 201);
});

const listCheckins = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM mood_checkins WHERE user_id = :uid ORDER BY id DESC LIMIT 100`,
    { uid: req.user.id }
  );
  return ok(res, { checkins: rows });
});

const saveDetector = asyncHandler(async (req, res) => {
  const p = req.body;
  if (!p.consent_accepted) return fail(res, 'Consent required', 400);
  const result = await query(
    `INSERT INTO mood_detector_results
      (user_id, detected_mood, confidence, consent_accepted, image_url, raw_payload)
     VALUES (:uid, :detected_mood, :confidence, 1, :image_url, :raw_payload)`,
    {
      uid: req.user.id,
      detected_mood: p.detected_mood,
      confidence: p.confidence ?? null,
      image_url: p.image_url || null,
      raw_payload: p.raw_payload ? JSON.stringify(p.raw_payload) : null,
    }
  );
  const rows = await query(`SELECT * FROM mood_detector_results WHERE id = :id`, { id: result.insertId });
  return ok(res, { result: rows[0] }, 'Mood detected', 201);
});

module.exports = { checkinSchema, detectorSchema, createCheckin, listCheckins, saveDetector };
