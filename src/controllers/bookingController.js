const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = Joi.object({
  therapist_id: Joi.number().integer().required(),
  booking_date: Joi.date().iso().required(),
  booking_time: Joi.string().required(),
  session_type: Joi.string().valid('video', 'audio', 'in_person').default('video'),
  beneficiary: Joi.string().allow('', null),
  note: Joi.string().allow('', null),
  amount: Joi.number().min(0).default(0),
  currency: Joi.string().default('SAR'),
  payment_method: Joi.string().allow('', null),
});

const listSpecialists = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `
    SELECT u.id, u.full_name, u.avatar_url, p.bio, p.years_experience, p.city, p.country,
           (SELECT GROUP_CONCAT(s.name_en SEPARATOR ', ')
              FROM therapist_specializations ts
              JOIN specializations s ON s.id = ts.specialization_id
             WHERE ts.therapist_id = u.id) AS specializations
    FROM users u
    JOIN therapist_profiles p ON p.user_id = u.id
    JOIN therapist_applications a ON a.user_id = u.id AND a.status = 'approved'
    WHERE u.role = 'therapist' AND u.is_active = 1`;
  const params = {};
  if (q) {
    sql += ` AND (u.full_name LIKE :q OR p.bio LIKE :q)`;
    params.q = `%${q}%`;
  }
  sql += ` ORDER BY u.full_name ASC`;
  const rows = await query(sql, params);
  return ok(res, { specialists: rows });
});

const getSpecialist = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.avatar_url, p.*
     FROM users u
     JOIN therapist_profiles p ON p.user_id = u.id
     WHERE u.id = :id AND u.role = 'therapist'`,
    { id: req.params.id }
  );
  if (!rows.length) return fail(res, 'Specialist not found', 404);
  const specs = await query(
    `SELECT s.id, s.slug, s.name_en, s.name_ar
     FROM therapist_specializations ts JOIN specializations s ON s.id = ts.specialization_id
     WHERE ts.therapist_id = :id`,
    { id: req.params.id }
  );
  return ok(res, { specialist: rows[0], specializations: specs });
});

const createBooking = asyncHandler(async (req, res) => {
  const p = req.body;
  const therapists = await query(`SELECT id FROM users WHERE id = :id AND role = 'therapist'`, {
    id: p.therapist_id,
  });
  if (!therapists.length) return fail(res, 'Specialist not found', 404);

  const result = await query(
    `INSERT INTO bookings
      (client_user_id, therapist_id, booking_date, booking_time, session_type, beneficiary, note, amount, currency, payment_method, status)
     VALUES (:uid, :tid, :booking_date, :booking_time, :session_type, :beneficiary, :note, :amount, :currency, :payment_method, 'pending_payment')`,
    {
      uid: req.user.id,
      tid: p.therapist_id,
      booking_date: p.booking_date,
      booking_time: p.booking_time,
      session_type: p.session_type,
      beneficiary: p.beneficiary || null,
      note: p.note || null,
      amount: p.amount,
      currency: p.currency,
      payment_method: p.payment_method || null,
    }
  );
  const rows = await query(`SELECT * FROM bookings WHERE id = :id`, { id: result.insertId });
  return ok(res, { booking: rows[0] }, 'Booking created', 201);
});

const checkout = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM bookings WHERE id = :id AND client_user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Booking not found', 404);
  const booking = rows[0];
  const dateStr = booking.booking_date instanceof Date
    ? booking.booking_date.toISOString().slice(0, 10)
    : String(booking.booking_date).slice(0, 10);
  const timeStr = String(booking.booking_time).slice(0, 8);
  const starts = `${dateStr} ${timeStr}`;
  // ensure therapist has client record
  let clients = await query(
    `SELECT id FROM therapist_clients WHERE therapist_id = :tid AND client_user_id = :uid`,
    { tid: booking.therapist_id, uid: req.user.id }
  );
  if (!clients.length) {
    const [user] = await query(`SELECT full_name, email, phone, avatar_url FROM users WHERE id = :uid`, {
      uid: req.user.id,
    });
    const created = await query(
      `INSERT INTO therapist_clients (therapist_id, client_user_id, full_name, email, phone, avatar_url)
       VALUES (:tid, :uid, :full_name, :email, :phone, :avatar_url)`,
      {
        tid: booking.therapist_id,
        uid: req.user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        avatar_url: user.avatar_url,
      }
    );
    clients = [{ id: created.insertId }];
  }

  const endsSql = await query(
    `SELECT DATE_ADD(:starts, INTERVAL 50 MINUTE) AS ends`,
    { starts }
  );
  const session = await query(
    `INSERT INTO sessions
      (therapist_id, client_id, title, session_type, status, starts_at, ends_at, duration_minutes, fee_amount, currency, join_url)
     VALUES (:tid, :cid, 'Booked session', :stype, 'scheduled', :starts, :ends, 50, :amount, :currency, NULL)`,
    {
      tid: booking.therapist_id,
      cid: clients[0].id,
      stype: booking.session_type,
      starts,
      ends: endsSql[0].ends,
      amount: booking.amount,
      currency: booking.currency,
    }
  );

  await query(
    `UPDATE bookings SET status = 'confirmed', session_id = :sid, payment_method = COALESCE(:pm, payment_method)
     WHERE id = :id`,
    { sid: session.insertId, pm: req.body.payment_method || null, id: booking.id }
  );
  const updated = await query(`SELECT * FROM bookings WHERE id = :id`, { id: booking.id });
  return ok(res, { booking: updated[0], session_id: session.insertId }, 'Booking confirmed');
});

const myBookings = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT b.*, u.full_name AS therapist_name, u.avatar_url AS therapist_avatar
     FROM bookings b
     JOIN users u ON u.id = b.therapist_id
     WHERE b.client_user_id = :uid
     ORDER BY b.id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { bookings: rows });
});

module.exports = {
  createSchema,
  listSpecialists,
  getSpecialist,
  createBooking,
  checkout,
  myBookings,
};
