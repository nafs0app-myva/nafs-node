const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { notify, formatForUser } = require('../utils/notify');
const { netAmount, PLATFORM_FEE_PERCENT } = require('../config/fees');
const { cancelBooking: settleCancellation } = require('../services/cancellationService');
const { wallClock } = require('../utils/time');
const { rtcTokenFor } = require('../services/agoraService');

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
        start_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),
        end_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),
        is_active: Joi.boolean().default(true),
      })
    )
    .required(),
});

// Client UTC offset in minutes (e.g. 180 for UTC+3); the DB stores UTC.
function tzOffset(req) {
  const n = Number.parseInt(req.query.tz_offset, 10);
  return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0;
}

const reviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(500).allow('', null),
});

// A client rates one of their completed sessions (once per session).
const review = asyncHandler(async (req, res) => {
  const [session] = await query(
    `SELECT s.id, s.therapist_id, s.status FROM sessions s
     JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.id = :id AND c.client_user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!session) return fail(res, 'Session not found', 404);
  if (session.status !== 'completed') return fail(res, 'You can only review a completed session', 400);
  const [existing] = await query(`SELECT id FROM session_reviews WHERE session_id = :id`, { id: session.id });
  if (existing) return fail(res, 'You already reviewed this session', 409);
  await query(
    `INSERT INTO session_reviews (session_id, therapist_id, client_user_id, rating, comment)
     VALUES (:sid, :tid, :uid, :rating, :comment)`,
    { sid: session.id, tid: session.therapist_id, uid: req.user.id, rating: req.body.rating, comment: req.body.comment || null }
  );
  await notify(session.therapist_id, {
    title: 'New review',
    body: `A client rated a session ${req.body.rating}/5.`,
    type: 'general',
  });
  return ok(res, null, 'Thanks for your review', 201);
});

const list = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const { date, from, to, status } = req.query;
  const isClient = req.user.role === 'client';
  let sql = isClient
    ? `SELECT s.*, c.full_name AS client_name, c.avatar_url AS client_avatar,
              t.full_name AS therapist_name, t.avatar_url AS therapist_avatar
       FROM sessions s
       JOIN therapist_clients c ON c.id = s.client_id
       JOIN users t ON t.id = s.therapist_id
       WHERE c.client_user_id = :uid`
    : `SELECT s.*, c.full_name AS client_name, c.avatar_url AS client_avatar
       FROM sessions s
       JOIN therapist_clients c ON c.id = s.client_id
       WHERE s.therapist_id = :uid`;
  const params = { uid };
  if (date) {
    sql += ` AND DATE(DATE_ADD(s.starts_at, INTERVAL :off MINUTE)) = :date`;
    params.date = date;
    params.off = tzOffset(req);
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

const secondsOf = (t) => {
  const [h = 0, m = 0] = String(t).split(':').map((n) => parseInt(n, 10) || 0);
  return h * 3600 + m * 60;
};

// True when a session starting at `startsAt` (UTC) overlaps one of the therapist's
// time-off blocks, whole-day or specific hours, on their local calendar.
async function isOnVacation(therapistId, startsAt, endsAt) {
  const [tp] = await query(`SELECT timezone FROM therapist_profiles WHERE user_id = :uid`, { uid: therapistId });
  const tz = tp?.timezone || 'Asia/Riyadh';
  const [day, time] = wallClock(new Date(startsAt), tz).split(' ');
  const start = secondsOf(time);
  const end = start + (endsAt ? Math.round((new Date(endsAt) - new Date(startsAt)) / 1000) : 50 * 60);
  const rows = await query(
    `SELECT TIME_FORMAT(start_time, '%H:%i') AS st, TIME_FORMAT(end_time, '%H:%i') AS et
     FROM vacation_blocks WHERE therapist_id = :uid AND :d BETWEEN start_date AND end_date`,
    { uid: therapistId, d: day }
  );
  return rows.some((r) => !r.st || (start < secondsOf(r.et) && end > secondsOf(r.st)));
}

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  if (await isOnVacation(req.user.id, p.starts_at, p.ends_at)) {
    return fail(res, 'You have time off on that date. Remove it before booking a session.', 409);
  }
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
  const [linked] = await query(`SELECT client_user_id FROM therapist_clients WHERE id = :cid`, { cid: p.client_id });
  await notify(linked?.client_user_id, {
    title: 'Session scheduled',
    body: `A session was scheduled for ${await formatForUser(linked?.client_user_id, p.starts_at)}.`,
    type: 'booking',
    category: 'client_bookings',
  });
  return ok(res, { session: rows[0] }, 'Session booked', 201);
});

// Credits the therapist's wallet once when a session is completed. Idempotent:
// a session that already has a `session_fee` transaction is skipped.
async function creditSessionFee(sessionId, therapistId) {
  return withTransaction(async (conn) => {
    const [[s]] = await conn.execute(
      `SELECT s.fee_amount, s.currency, c.full_name AS client_name
       FROM sessions s JOIN therapist_clients c ON c.id = s.client_id
       WHERE s.id = :id AND s.status = 'completed'`,
      { id: sessionId }
    );
    if (!s || Number(s.fee_amount) <= 0) return null;
    const [[dup]] = await conn.execute(
      `SELECT id FROM wallet_transactions
       WHERE reference_type = 'session' AND reference_id = :id AND type = 'session_fee'`,
      { id: sessionId }
    );
    if (dup) return null;
    let [[wallet]] = await conn.execute(`SELECT id FROM wallets WHERE user_id = :uid FOR UPDATE`, {
      uid: therapistId,
    });
    if (!wallet) {
      const [ins] = await conn.execute(
        `INSERT INTO wallets (user_id, balance, currency) VALUES (:uid, 0, :cur)`,
        { uid: therapistId, cur: s.currency }
      );
      wallet = { id: ins.insertId };
    }
    const net = netAmount(s.fee_amount); // the therapist's share after the platform fee
    await conn.execute(`UPDATE wallets SET balance = balance + :amount WHERE id = :id`, {
      amount: net,
      id: wallet.id,
    });
    await conn.execute(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount, currency, status, description, reference_type, reference_id)
       VALUES (:wid, :uid, 'session_fee', :amount, :cur, 'completed', :descr, 'session', :sid)`,
      {
        wid: wallet.id,
        uid: therapistId,
        amount: net,
        cur: s.currency,
        descr: `Session with ${s.client_name} (after ${PLATFORM_FEE_PERCENT}% platform fee)`,
        sid: sessionId,
      }
    );
    return { amount: net, currency: s.currency };
  });
}

const update = asyncHandler(async (req, res) => {
  const existing = await query(`SELECT id FROM sessions WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!existing.length) return fail(res, 'Session not found', 404);
  const p = req.body;
  if (p.starts_at && (await isOnVacation(req.user.id, p.starts_at, p.ends_at))) {
    return fail(res, 'You have time off on that date.', 409);
  }
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
  if (p.status === 'completed') {
    const credited = await creditSessionFee(req.params.id, req.user.id);
    if (credited) {
      await notify(req.user.id, {
        title: 'Session fee credited',
        body: `${credited.amount} ${credited.currency} was added to your wallet.`,
        type: 'payment',
        category: 'financial',
      });
    }
  }
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
  // A session that came from a paid booking is cancelled through the booking
  // so the client is refunded in full.
  const [booking] = await query(
    `SELECT * FROM bookings WHERE session_id = :sid AND status IN ('confirmed','pending_payment')`,
    { sid: req.params.id }
  );
  if (booking) {
    await settleCancellation(booking, 'therapist');
  } else {
    await query(`UPDATE sessions SET status = 'cancelled' WHERE id = :id`, { id: req.params.id });
  }
  const updated = await query(`SELECT * FROM sessions WHERE id = :id`, { id: req.params.id });
  if (!booking) {
    // Bookings notify the client themselves (with the refund); plain sessions do it here.
    const [linked] = await query(`SELECT client_user_id FROM therapist_clients WHERE id = :cid`, { cid: rows[0].client_id });
    await notify(linked?.client_user_id, {
      title: 'Session cancelled',
      body: 'Your therapist cancelled an upcoming session. Please rebook a new time.',
      type: 'booking',
      category: 'client_bookings',
    });
  }
  return ok(res, { session: updated[0] }, 'Session cancelled');
});

const join = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT s.* FROM sessions s
     LEFT JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.id = :id AND (s.therapist_id = :uid OR c.client_user_id = :uid)`,
    { id: req.params.id, uid: req.user.id }
  );
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
  // One channel per session, so concurrent calls never share a room. The token
  // is bound to this channel and to the caller's user id (the Agora uid).
  const channel = `nafs-session-${session.id}`;
  const uid = Number(req.user.id);
  return ok(res, {
    join_url: session.join_url,
    channel,
    rtc_token: rtcTokenFor(channel, uid),
    uid,
    session,
  });
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
  const [tp] = await query(`SELECT timezone, session_duration_minutes FROM therapist_profiles WHERE user_id = :uid`, { uid: req.user.id });
  return ok(res, { slots: rows, timezone: tp?.timezone || 'Asia/Riyadh', session_duration_minutes: Number(tp?.session_duration_minutes) || 50 });
});

const setAvailability = asyncHandler(async (req, res) => {
  const slots = req.body.slots;
  // Every slot must end after it starts, and slots on one day must not overlap.
  const byDay = new Map();
  for (const s of slots) {
    if (secondsOf(s.start_time) >= secondsOf(s.end_time)) return fail(res, 'Each time slot must end after it starts', 422);
    byDay.set(s.weekday, [...(byDay.get(s.weekday) || []), [secondsOf(s.start_time), secondsOf(s.end_time)]]);
  }
  for (const [, ranges] of byDay) {
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i += 1) {
      if (ranges[i][0] < ranges[i - 1][1]) return fail(res, 'Time slots on the same day must not overlap', 422);
    }
  }
  await withTransaction(async (conn) => {
    await conn.execute(`DELETE FROM availability_slots WHERE therapist_id = :uid`, { uid: req.user.id });
    for (const slot of slots) {
      await conn.execute(
        `INSERT INTO availability_slots (therapist_id, weekday, start_time, end_time, is_active)
         VALUES (:uid, :weekday, :start_time, :end_time, :is_active)`,
        { uid: req.user.id, weekday: slot.weekday, start_time: slot.start_time, end_time: slot.end_time, is_active: slot.is_active ? 1 : 0 }
      );
    }
  });

  // Tell the therapist how many already-booked sessions now fall outside their hours.
  const [tp] = await query(`SELECT timezone FROM therapist_profiles WHERE user_id = :id`, { id: req.user.id });
  const tz = tp?.timezone || 'Asia/Riyadh';
  const upcoming = await query(
    `SELECT starts_at FROM sessions WHERE therapist_id = :uid AND status = 'scheduled' AND starts_at > UTC_TIMESTAMP()`,
    { uid: req.user.id }
  );
  const active = slots.filter((s) => s.is_active);
  const outside = upcoming.filter((s) => {
    const [d, t] = wallClock(new Date(s.starts_at), tz).split(' ');
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    const sec = secondsOf(t);
    return !active.some((a) => a.weekday === weekday && sec >= secondsOf(a.start_time) && sec < secondsOf(a.end_time));
  }).length;

  const rows = await query(
    `SELECT id, weekday, start_time, end_time, is_active FROM availability_slots WHERE therapist_id = :uid ORDER BY weekday, start_time`,
    { uid: req.user.id }
  );
  return ok(res, { slots: rows, sessions_outside_schedule: outside, timezone: tz }, 'Schedule saved');
});

const calendar = asyncHandler(async (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(res, 'Query month required as YYYY-MM', 422);
  }
  // Cast ENUM status / DATE_FORMAT strings to a single collation so Hostinger
  // (utf8mb4_general_ci connections vs utf8mb4_unicode_ci tables) does not error.
  const rows = await query(
    `SELECT DATE_FORMAT(DATE_ADD(starts_at, INTERVAL :off MINUTE), '%Y-%m-%d') AS day,
            COUNT(*) AS sessions_count,
            SUM(CAST(status AS CHAR) COLLATE utf8mb4_unicode_ci = 'scheduled') AS scheduled_count
     FROM sessions
     WHERE therapist_id = :uid
       AND CAST(status AS CHAR) COLLATE utf8mb4_unicode_ci <> 'cancelled'
       AND DATE_FORMAT(DATE_ADD(starts_at, INTERVAL :off MINUTE), '%Y-%m') COLLATE utf8mb4_unicode_ci = :month
     GROUP BY day
     ORDER BY day ASC`,
    { uid: req.user.id, month, off: tzOffset(req) }
  );
  // Time-off days in this month, expanded to `YYYY-MM-DD` strings.
  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const blocks = await query(
    `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e,
            TIME_FORMAT(start_time, '%H:%i') AS st, TIME_FORMAT(end_time, '%H:%i') AS et
     FROM vacation_blocks WHERE therapist_id = :uid AND start_date <= :me AND end_date >= :ms`,
    { uid: req.user.id, ms: monthStart, me: monthEnd }
  );
  const vacationDays = new Set();
  const partialDays = blocks.filter((b) => b.st).map((b) => ({ date: b.s, start_time: b.st, end_time: b.et }));
  for (const blk of blocks.filter((b) => !b.st)) {
    const from = blk.s < monthStart ? monthStart : blk.s;
    const to = blk.e > monthEnd ? monthEnd : blk.e;
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      vacationDays.add(d.toISOString().slice(0, 10));
    }
  }
  return ok(res, { month, days: rows, vacation_days: [...vacationDays].sort(), partial_vacation_days: partialDays });
});

module.exports = {
  createSchema,
  updateSchema,
  reviewSchema,
  review,
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
