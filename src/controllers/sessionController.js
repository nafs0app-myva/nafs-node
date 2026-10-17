const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = Joi.object({
  client_id: Joi.number().integer().required(),
  title: Joi.string().allow('', null),
  session_type: Joi.string().valid('video', 'audio', 'in_person').default('video'),
  starts_at: Joi.date().iso().required(),
  ends_at: Joi.date().iso().required(),
  duration_minutes: Joi.number().integer().min(15).default(50),
  fee_amount: Joi.number().min(0).default(0),
  currency: Joi.string().default('SAR'),
  join_url: Joi.string().uri().allow('', null),
});

const updateSchema = Joi.object({
  title: Joi.string().allow('', null),
  session_type: Joi.string().valid('video', 'audio', 'in_person'),
  status: Joi.string().valid('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
  starts_at: Joi.date().iso(),
  ends_at: Joi.date().iso(),
  duration_minutes: Joi.number().integer().min(15),
  fee_amount: Joi.number().min(0),
  join_url: Joi.string().uri().allow('', null),
}).min(1);

const availabilitySchema = Joi.object({
  slots: Joi.array()
    .items(
      Joi.object({
        weekday: Joi.number().integer().min(0).max(6).required(),
        start_time: Joi.string().required(),
        end_time: Joi.string().required(),
        is_active: Joi.boolean().default(true),
      })
    )
    .required(),
});

const list = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const { date, from, to, status } = req.query;
  let sql = `SELECT s.*, c.full_name AS client_name, c.avatar_url AS client_avatar
             FROM sessions s
             JOIN therapist_clients c ON c.id = s.client_id
             WHERE s.therapist_id = :uid`;
  const params = { uid };
  if (date) {
    sql += ` AND DATE(s.starts_at) = :date`;
    params.date = date;
  }
  if (from) {
    sql += ` AND s.starts_at >= :from`;
    params.from = from;
  }
  if (to) {
    sql += ` AND s.starts_at <= :to`;
    params.to = to;
  }
  if (status) {
    sql += ` AND s.status = :status`;
    params.status = status;
  }
  sql += ` ORDER BY s.starts_at ASC`;
  const rows = await query(sql, params);
  return ok(res, { sessions: rows });
});

const getOne = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT s.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone
     FROM sessions s JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.id = :id AND s.therapist_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!rows.length) return fail(res, 'Session not found', 404);
  const notes = await query(
    `SELECT id, body, is_private, created_at FROM session_notes WHERE session_id = :id ORDER BY id DESC`,
    { id: req.params.id }
  );
  return ok(res, { session: rows[0], notes });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const clients = await query(
    `SELECT id FROM therapist_clients WHERE id = :cid AND therapist_id = :uid`,
    { cid: p.client_id, uid: req.user.id }
  );
  if (!clients.length) return fail(res, 'Client not found', 404);
  const result = await query(
    `INSERT INTO sessions
      (therapist_id, client_id, title, session_type, starts_at, ends_at, duration_minutes, fee_amount, currency, join_url)
     VALUES (:uid, :client_id, :title, :session_type, :starts_at, :ends_at, :duration_minutes, :fee_amount, :currency, :join_url)`,
    {
      uid: req.user.id,
      client_id: p.client_id,
      title: p.title || null,
      session_type: p.session_type,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      duration_minutes: p.duration_minutes,
      fee_amount: p.fee_amount,
      currency: p.currency,
      join_url: p.join_url || null,
    }
  );
  await query(`UPDATE therapist_clients SET last_session_at = :starts_at WHERE id = :cid`, {
    starts_at: p.starts_at,
    cid: p.client_id,
  });
  const rows = await query(`SELECT * FROM sessions WHERE id = :id`, { id: result.insertId });
  return ok(res, { session: rows[0] }, 'Session booked', 201);
});

const update = asyncHandler(async (req, res) => {
  const existing = await query(`SELECT id FROM sessions WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing.length) return fail(res, 'Session not found', 404);
  const p = req.body;
  const fields = [];
  const params = { id: req.params.id };
  for (const key of [
    'title',
    'session_type',
    'status',
    'starts_at',
    'ends_at',
    'duration_minutes',
    'fee_amount',
    'join_url',
  ]) {
    if (p[key] !== undefined) {
      fields.push(`${key} = :${key}`);
      params[key] = p[key];
    }
  }
  await query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = :id`, params);
  const rows = await query(`SELECT * FROM sessions WHERE id = :id`, { id: req.params.id });
  return ok(res, { session: rows[0] }, 'Session updated');
});

const cancel = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM sessions WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Session not found', 404);
  if (['completed', 'cancelled'].includes(rows[0].status)) {
    return fail(res, `Cannot cancel a ${rows[0].status} session`, 400);
  }
  await query(`UPDATE sessions SET status = 'cancelled' WHERE id = :id`, { id: req.params.id });
  const updated = await query(`SELECT * FROM sessions WHERE id = :id`, { id: req.params.id });
  return ok(res, { session: updated[0] }, 'Session cancelled');
});

const join = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM sessions WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Session not found', 404);
  const session = rows[0];
  if (!session.join_url) {
    const join_url = `https://meet.nafs.app/s/${session.id}`;
    await query(`UPDATE sessions SET join_url = :join_url, status = 'in_progress' WHERE id = :id`, {
      join_url,
      id: session.id,
    });
    session.join_url = join_url;
    session.status = 'in_progress';
  } else if (session.status === 'scheduled') {
    await query(`UPDATE sessions SET status = 'in_progress' WHERE id = :id`, { id: session.id });
    session.status = 'in_progress';
  }
  return ok(res, { join_url: session.join_url, session });
});

const addNote = asyncHandler(async (req, res) => {
  const existing = await query(`SELECT id FROM sessions WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing.length) return fail(res, 'Session not found', 404);
  const result = await query(
    `INSERT INTO session_notes (session_id, therapist_id, body, is_private)
     VALUES (:sid, :uid, :body, :is_private)`,
    {
      sid: req.params.id,
      uid: req.user.id,
      body: req.body.body,
      is_private: req.body.is_private === false ? 0 : 1,
    }
  );
  const rows = await query(`SELECT * FROM session_notes WHERE id = :id`, { id: result.insertId });
  return ok(res, { note: rows[0] }, 'Note added', 201);
});

const getAvailability = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, weekday, start_time, end_time, is_active
     FROM availability_slots WHERE therapist_id = :uid ORDER BY weekday, start_time`,
    { uid: req.user.id }
  );
  return ok(res, { slots: rows });
});

const setAvailability = asyncHandler(async (req, res) => {
  await query(`DELETE FROM availability_slots WHERE therapist_id = :uid`, { uid: req.user.id });
  for (const slot of req.body.slots) {
    await query(
      `INSERT INTO availability_slots (therapist_id, weekday, start_time, end_time, is_active)
       VALUES (:uid, :weekday, :start_time, :end_time, :is_active)`,
      {
        uid: req.user.id,
        weekday: slot.weekday,
        start_time: slot.start_time,
        end_time: slot.end_time,
        is_active: slot.is_active ? 1 : 0,
      }
    );
  }
  return getAvailability(req, res);
});

const calendar = asyncHandler(async (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(res, 'Query month required as YYYY-MM', 422);
  }
  const rows = await query(
    `SELECT DATE(starts_at) AS day, COUNT(*) AS sessions_count,
            SUM(status = 'scheduled') AS scheduled_count
     FROM sessions
     WHERE therapist_id = :uid AND DATE_FORMAT(starts_at, '%Y-%m') = :month
     GROUP BY DATE(starts_at)
     ORDER BY day ASC`,
    { uid: req.user.id, month }
  );
  return ok(res, { month, days: rows });
});

module.exports = {
  createSchema,
  updateSchema,
  availabilitySchema,
  list,
  getOne,
  create,
  update,
  join,
  cancel,
  addNote,
  getAvailability,
  setAvailability,
  calendar,
};
