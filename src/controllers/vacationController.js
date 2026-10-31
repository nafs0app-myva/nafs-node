const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const { notify, formatForUser } = require('../utils/notify');
const asyncHandler = require('../utils/asyncHandler');
const { wallClock } = require('../utils/time');
const { toSeconds } = require('../services/availabilityService');
const { cancelBooking: settleCancellation } = require('../services/cancellationService');

const TIME = Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/);

const writeSchema = {
  start_date: Joi.date().iso(),
  end_date: Joi.date().iso(),
  // Optional hours for a single-day block; both or neither. Without them the whole day is blocked.
  start_time: TIME.allow(null, ''),
  end_time: TIME.allow(null, ''),
  reason: Joi.string().allow('', null),
  // Cancel scheduled sessions / bookings that fall inside the block (and notify clients).
  cancel_conflicts: Joi.boolean().default(false),
};
const createSchema = Joi.object({ ...writeSchema, start_date: writeSchema.start_date.required(), end_date: writeSchema.end_date.required() });
const updateSchema = Joi.object(writeSchema).min(1);

async function therapistProfile(uid) {
  const [tp] = await query(`SELECT timezone, session_duration_minutes FROM therapist_profiles WHERE user_id = :uid`, { uid });
  return { tz: tp?.timezone || 'Asia/Riyadh', durationSec: (Number(tp?.session_duration_minutes) || 50) * 60 };
}

const ymd = (v) => new Date(v).toISOString().slice(0, 10);
const norm = (t) => (t ? (String(t).length === 5 ? `${t}:00` : String(t).slice(0, 8)) : null);

/** True when a block (`start_date`/`end_date`/optional times) covers an appointment (`date`, `start`, `end` seconds). */
function covers(block, appt) {
  if (appt.date < block.start_date || appt.date > block.end_date) return false;
  if (!block.start_time || !block.end_time) return true;
  return appt.start < toSeconds(block.end_time) && appt.end > toSeconds(block.start_time);
}

/** Do two blocks overlap in time (whole-day blocks overlap anything on the same dates)? */
function blocksOverlap(a, b) {
  if (a.start_date > b.end_date || b.start_date > a.end_date) return false;
  if (!a.start_time || !b.start_time) return true;
  return toSeconds(a.start_time) < toSeconds(b.end_time) && toSeconds(b.start_time) < toSeconds(a.end_time);
}

const SELECT_BLOCKS = `
  SELECT v.id, DATE_FORMAT(v.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(v.end_date, '%Y-%m-%d') AS end_date,
         TIME_FORMAT(v.start_time, '%H:%i:%s') AS start_time, TIME_FORMAT(v.end_time, '%H:%i:%s') AS end_time,
         v.reason, v.created_at
  FROM vacation_blocks v`;

/** Active appointments of the therapist, as local `{date,start,end}` plus the row. */
async function activeAppointments(uid, { tz, durationSec }) {
  const sessions = (
    await query(
      `SELECT s.id, s.starts_at, s.ends_at, c.client_user_id,
              (SELECT b.id FROM bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed','pending_payment') LIMIT 1) AS booking_id
       FROM sessions s JOIN therapist_clients c ON c.id = s.client_id
       WHERE s.therapist_id = :uid AND s.status = 'scheduled'`,
      { uid }
    )
  ).map((s) => {
    const [date, t] = wallClock(new Date(s.starts_at), tz).split(' ');
    const start = toSeconds(t);
    return { ...s, date, start, end: start + Math.max(durationSec, Math.round((new Date(s.ends_at) - new Date(s.starts_at)) / 1000)) };
  });
  const bookings = (
    await query(`SELECT * FROM bookings WHERE therapist_id = :uid AND status IN ('confirmed','pending_payment')`, { uid })
  ).map((b) => {
    const start = toSeconds(b.booking_time);
    return { ...b, date: ymd(b.booking_date), start, end: start + durationSec };
  });
  return { sessions, bookings };
}

async function withConflictCounts(uid, blocks) {
  if (!blocks.length) return blocks;
  const { sessions } = await activeAppointments(uid, await therapistProfile(uid));
  return blocks.map((b) => ({ ...b, conflicts_count: sessions.filter((s) => covers(b, s)).length }));
}

const list = asyncHandler(async (req, res) => {
  const rows = await query(`${SELECT_BLOCKS} WHERE v.therapist_id = :uid ORDER BY v.start_date DESC, v.start_time`, { uid: req.user.id });
  return ok(res, { vacations: await withConflictCounts(req.user.id, rows) });
});

/** Validates the dates/times of a block; returns `{ error }` or the normalised block. */
async function normalise(uid, input, existing) {
  const { tz } = await therapistProfile(uid);
  const block = {
    start_date: input.start_date !== undefined ? ymd(input.start_date) : existing.start_date,
    end_date: input.end_date !== undefined ? ymd(input.end_date) : existing.end_date,
    start_time: input.start_time !== undefined ? norm(input.start_time) : existing?.start_time || null,
    end_time: input.end_time !== undefined ? norm(input.end_time) : existing?.end_time || null,
    reason: input.reason !== undefined ? input.reason || null : existing?.reason || null,
  };
  if (block.end_date < block.start_date) return { error: 'end_date must be on/after start_date' };
  const today = wallClock(new Date(), tz).slice(0, 10);
  // An existing block that has already started may keep its start date.
  if (block.start_date < today && block.start_date !== existing?.start_date) return { error: 'Time off cannot start in the past' };
  if (!!block.start_time !== !!block.end_time) return { error: 'Provide both a start time and an end time, or neither' };
  if (block.start_time) {
    if (block.start_date !== block.end_date) return { error: 'Specific hours can only be set for a single day' };
    if (toSeconds(block.start_time) >= toSeconds(block.end_time)) return { error: 'The end time must be after the start time' };
  }
  return { block };
}

/** Cancels the appointments a block now covers (the caller already got consent). */
async function cancelCovered(uid, blockId, covered) {
  await withTransaction(async (conn) => {
    for (const s of covered.plainSessions) {
      await conn.execute(`UPDATE sessions SET status = 'cancelled', cancelled_by_vacation_id = :vid WHERE id = :id`, { id: s.id, vid: blockId });
    }
  });
  // Bookings go through the cancellation service so paid ones are refunded in full.
  for (const bk of covered.bookings) {
    await settleCancellation(bk, 'therapist');
    await query(`UPDATE bookings SET cancelled_by_vacation_id = :vid WHERE id = :id`, { vid: blockId, id: bk.id });
    if (bk.session_id) await query(`UPDATE sessions SET cancelled_by_vacation_id = :vid WHERE id = :id`, { vid: blockId, id: bk.session_id });
  }
}

async function conflictsFor(uid, block, profile) {
  const { sessions, bookings } = await activeAppointments(uid, profile);
  const bookingsIn = bookings.filter((b) => covers(block, b));
  // A booked session appears as both a session and a booking: count/cancel it through the booking.
  const plainSessions = sessions.filter((s) => !s.booking_id && covers(block, s));
  return { plainSessions, bookings: bookingsIn, count: plainSessions.length + bookingsIn.length };
}

const rangeLabel = (b) => (b.start_date === b.end_date ? b.start_date : `${b.start_date} to ${b.end_date}`) + (b.start_time ? ` ${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)}` : '');

async function notifyCancelledSessions(sessions, block) {
  const users = new Set(sessions.map((x) => x.client_user_id).filter(Boolean));
  for (const uid of users) {
    await notify(uid, {
      title: 'Appointment cancelled',
      body: `Your therapist is on time off (${rangeLabel(block)}); your appointment was cancelled. Please rebook.`,
      type: 'booking',
      category: 'client_bookings',
    });
  }
}

const create = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const checked = await normalise(uid, req.body, null);
  if (checked.error) return fail(res, checked.error, 422);
  const block = checked.block;

  const existing = await query(`${SELECT_BLOCKS} WHERE v.therapist_id = :uid AND v.start_date <= :end AND v.end_date >= :start`, { uid, start: block.start_date, end: block.end_date });
  if (existing.some((e) => blocksOverlap(e, block))) return fail(res, 'You already have time off during these dates', 409);

  const profile = await therapistProfile(uid);
  const covered = await conflictsFor(uid, block, profile);
  if (covered.count > 0 && !req.body.cancel_conflicts) {
    return fail(res, `${covered.count} scheduled appointment${covered.count === 1 ? '' : 's'} fall in this period`, 409, [
      { code: 'has_conflicts', count: covered.count, message: `${covered.count} scheduled appointments fall in this period` },
    ]);
  }
  const result = await query(
    `INSERT INTO vacation_blocks (therapist_id, start_date, end_date, start_time, end_time, reason)
     VALUES (:uid, :start_date, :end_date, :start_time, :end_time, :reason)`,
    { uid, ...block }
  );
  await cancelCovered(uid, result.insertId, covered);
  await notifyCancelledSessions(covered.plainSessions, block);
  const rows = await query(`${SELECT_BLOCKS} WHERE v.id = :id`, { id: result.insertId });
  return ok(res, { vacation: (await withConflictCounts(uid, rows))[0] }, 'Time off saved', 201);
});

/**
 * Restores what a block cancelled (future, not refunded). `keep(appt)` can veto
 * an appointment, e.g. one that the block still covers after an edit.
 */
async function restoreCancelled(blockId, profile, keepCancelled = () => false) {
  const sessions = (
    await query(
      `SELECT s.id, s.starts_at, s.ends_at, c.client_user_id FROM sessions s
       JOIN therapist_clients c ON c.id = s.client_id
       WHERE s.cancelled_by_vacation_id = :id AND s.status = 'cancelled' AND s.starts_at > UTC_TIMESTAMP()
         AND NOT EXISTS (SELECT 1 FROM wallet_transactions w JOIN bookings b ON b.id = w.reference_id
                          WHERE w.reference_type = 'booking' AND w.type = 'refund' AND b.session_id = s.id)`,
      { id: blockId }
    )
  ).map((s) => {
    const [date, t] = wallClock(new Date(s.starts_at), profile.tz).split(' ');
    const start = toSeconds(t);
    return { ...s, date, start, end: start + profile.durationSec };
  });
  const bookings = (
    await query(
      `SELECT id, client_user_id, session_id, booking_date, booking_time FROM bookings
       WHERE cancelled_by_vacation_id = :id AND status = 'cancelled'
         AND TIMESTAMP(booking_date, booking_time) > UTC_TIMESTAMP()
         AND NOT EXISTS (SELECT 1 FROM wallet_transactions w
                          WHERE w.reference_type = 'booking' AND w.type = 'refund' AND w.reference_id = bookings.id)`,
      { id: blockId }
    )
  ).map((b) => ({ ...b, date: ymd(b.booking_date), start: toSeconds(b.booking_time), end: toSeconds(b.booking_time) + profile.durationSec }));

  const restoreSessions = sessions.filter((s) => !keepCancelled(s));
  const restoreBookings = bookings.filter((b) => !keepCancelled(b));
  await withTransaction(async (conn) => {
    for (const s of restoreSessions) await conn.execute(`UPDATE sessions SET status = 'scheduled', cancelled_by_vacation_id = NULL WHERE id = :id`, { id: s.id });
    for (const b of restoreBookings) {
      await conn.execute(`UPDATE bookings SET status = :status, cancelled_by_vacation_id = NULL WHERE id = :id`, { id: b.id, status: b.session_id ? 'confirmed' : 'pending_payment' });
    }
  });
  const notified = new Set();
  for (const s of restoreSessions) {
    if (!s.client_user_id || notified.has(s.client_user_id)) continue;
    notified.add(s.client_user_id);
    await notify(s.client_user_id, { title: 'Appointment restored', body: `Your session on ${await formatForUser(s.client_user_id, s.starts_at)} is back on.`, type: 'booking', category: 'client_bookings' });
  }
  for (const b of restoreBookings) {
    if (!b.client_user_id || notified.has(b.client_user_id)) continue;
    notified.add(b.client_user_id);
    await notify(b.client_user_id, { title: 'Appointment restored', body: 'Your therapist is available again and your booking was restored.', type: 'booking', category: 'client_bookings' });
  }
  return { sessions: restoreSessions.length, bookings: restoreBookings.length };
}

// Editing a block: appointments it no longer covers are restored, ones it newly
// covers are cancelled (with the same consent step as creating).
const update = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const [current] = await query(`${SELECT_BLOCKS} WHERE v.id = :id AND v.therapist_id = :uid`, { id: req.params.id, uid });
  if (!current) return fail(res, 'Vacation not found', 404);
  const checked = await normalise(uid, req.body, current);
  if (checked.error) return fail(res, checked.error, 422);
  const block = checked.block;

  const others = (await query(`${SELECT_BLOCKS} WHERE v.therapist_id = :uid AND v.id <> :id AND v.start_date <= :end AND v.end_date >= :start`, { uid, id: current.id, start: block.start_date, end: block.end_date }));
  if (others.some((e) => blocksOverlap(e, block))) return fail(res, 'You already have time off during these dates', 409);

  const profile = await therapistProfile(uid);
  const covered = await conflictsFor(uid, block, profile);
  if (covered.count > 0 && !req.body.cancel_conflicts) {
    return fail(res, `${covered.count} scheduled appointment${covered.count === 1 ? '' : 's'} fall in this period`, 409, [
      { code: 'has_conflicts', count: covered.count, message: `${covered.count} scheduled appointments fall in this period` },
    ]);
  }
  await query(
    `UPDATE vacation_blocks SET start_date = :start_date, end_date = :end_date, start_time = :start_time, end_time = :end_time, reason = :reason
     WHERE id = :id`,
    { ...block, id: current.id }
  );
  await cancelCovered(uid, current.id, covered);
  await notifyCancelledSessions(covered.plainSessions, block);
  // Whatever this block cancelled earlier but no longer covers comes back.
  await restoreCancelled(current.id, profile, (appt) => covers(block, appt));
  const rows = await query(`${SELECT_BLOCKS} WHERE v.id = :id`, { id: current.id });
  return ok(res, { vacation: (await withConflictCounts(uid, rows))[0] }, 'Time off updated');
});

// Deleting a block restores the sessions / bookings it cancelled (only those
// still in the future and not refunded) and tells the clients.
const remove = asyncHandler(async (req, res) => {
  const [block] = await query(`SELECT id FROM vacation_blocks WHERE id = :id AND therapist_id = :uid`, { id: req.params.id, uid: req.user.id });
  if (!block) return fail(res, 'Vacation not found', 404);
  const restored = await restoreCancelled(block.id, await therapistProfile(req.user.id));
  await query(`UPDATE sessions SET cancelled_by_vacation_id = NULL WHERE cancelled_by_vacation_id = :id`, { id: block.id });
  await query(`UPDATE bookings SET cancelled_by_vacation_id = NULL WHERE cancelled_by_vacation_id = :id`, { id: block.id });
  await query(`DELETE FROM vacation_blocks WHERE id = :id`, { id: block.id });
  return ok(res, { restored_sessions: restored.sessions, restored_bookings: restored.bookings }, 'Deleted');
});

module.exports = { createSchema, updateSchema, list, create, update, remove };
