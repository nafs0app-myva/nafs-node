const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { notify } = require('../utils/notify');
const { previewCancellation, cancelBooking: settleCancellation } = require('../services/cancellationService');
const { bookableTimes } = require('../services/availabilityService');
const env = require('../config/env');
const moyasar = require('../services/moyasarService');
const { zonedToUtc, toMysqlUtc } = require('../utils/time');

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
    SELECT u.id, u.full_name, u.avatar_url, p.bio, p.headline, p.frameworks, p.practice_scope, p.years_experience, p.city, p.country,
           (SELECT GROUP_CONCAT(s.name_en SEPARATOR ', ')
              FROM therapist_specializations ts
              JOIN specializations s ON s.id = ts.specialization_id
             WHERE ts.therapist_id = u.id) AS specializations,
           (SELECT ROUND(AVG(r.rating), 1) FROM session_reviews r WHERE r.therapist_id = u.id) AS rating,
           (SELECT COUNT(*) FROM session_reviews r WHERE r.therapist_id = u.id) AS review_count
    FROM users u
    JOIN therapist_profiles p ON p.user_id = u.id
    JOIN therapist_applications a ON a.user_id = u.id AND a.status = 'approved'
    WHERE u.role = 'therapist' AND u.is_active = 1`;
  const params = {};
  if (q) {
    sql += ` AND (u.full_name LIKE :q OR p.bio LIKE :q)`;
    params.q = `%${q}%`;
  }
  // Optional focus-area filter: `?specialization=<slug or id>`.
  const spec = String(req.query.specialization || '').trim();
  if (spec) {
    sql += ` AND EXISTS (SELECT 1 FROM therapist_specializations ts JOIN specializations s ON s.id = ts.specialization_id
                         WHERE ts.therapist_id = u.id AND (s.slug = :spec OR s.id = :spec_id))`;
    params.spec = spec;
    params.spec_id = Number.isInteger(Number(spec)) ? Number(spec) : 0;
  }
  // Optional scope filters: `?age_group=<id>` and `?format=<id>`.
  for (const [param, key] of [['age_group', 'age_groups'], ['format', 'formats']]) {
    const value = String(req.query[param] || '').trim();
    if (value) {
      sql += ` AND JSON_CONTAINS(p.practice_scope, JSON_QUOTE(:${param}), '$.${key}')`;
      params[param] = value;
    }
  }
  // Optional modality filter: `?modality=<slug>` (stored in practice_scope.modalities).
  const modality = String(req.query.modality || '').trim();
  if (modality) {
    sql += ` AND JSON_CONTAINS(p.practice_scope, JSON_QUOTE(:modality), '$.modalities')`;
    params.modality = modality;
  }
  sql += ` ORDER BY u.full_name ASC`;
  const parse = (v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  const catalogue = new Map((await query(`SELECT slug, name_en FROM modalities`)).map((m) => [m.slug, m.name_en]));
  const rows = (await query(sql, params)).map(({ practice_scope: scope, ...r }) => {
    const parsedScope = parse(scope) || {};
    const custom = parse(r.frameworks);
    const slugs = parse(scope)?.modalities;
    const modalityNames = (Array.isArray(slugs) ? slugs : []).map((s) => catalogue.get(s)).filter(Boolean);
    // `frameworks` = every method shown to clients: catalogue modalities + the therapist's own.
    return {
      ...r,
      age_groups: Array.isArray(parsedScope.age_groups) ? parsedScope.age_groups : [],
      formats: Array.isArray(parsedScope.formats) ? parsedScope.formats : [],
      frameworks: [...modalityNames, ...(Array.isArray(custom) ? custom : [])],
    };
  });
  return ok(res, { specialists: rows });
});

const getSpecialist = asyncHandler(async (req, res) => {
  const rows = await query(
    // Public columns only: never identity numbers, address, bank details or admin notes.
    `SELECT u.id, u.full_name, u.avatar_url, p.bio, p.headline, p.frameworks, p.years_experience, p.city, p.country,
            p.timezone, p.session_fee_default, p.session_duration_minutes, p.native_language, p.languages, p.practice_scope
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
  const [agg] = await query(
    `SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS review_count FROM session_reviews WHERE therapist_id = :id`,
    { id: req.params.id }
  );
  return ok(res, {
    specialist: { ...rows[0], rating: agg.review_count > 0 ? Number(agg.rating) : null, review_count: Number(agg.review_count) },
    specializations: specs,
  });
});

const createBooking = asyncHandler(async (req, res) => {
  const p = req.body;
  const therapists = await query(
    `SELECT u.id, tp.session_fee_default FROM users u
     LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
     WHERE u.id = :id AND u.role = 'therapist'`,
    { id: p.therapist_id }
  );
  if (!therapists.length) return fail(res, 'Specialist not found', 404);
  // The price is the therapist's own rate; a client-supplied amount is ignored.
  const price = Number(therapists[0].session_fee_default) || 0;

  // The slot must be open: inside the weekly hours, not on time off, not taken, not in the past.
  const bookingDate = new Date(p.booking_date).toISOString().slice(0, 10);
  const wantedTime = String(p.booking_time).length === 5 ? `${p.booking_time}:00` : String(p.booking_time).slice(0, 8);
  const weekday = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
  const open = (await bookableTimes(p.therapist_id, [{ iso: bookingDate, weekday }])).get(bookingDate);
  if (!open.includes(wantedTime)) return fail(res, 'That time is no longer available. Please pick another slot.', 409);

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
      amount: price,
      currency: 'SAR',
      payment_method: p.payment_method || null,
    }
  );
  const rows = await query(`SELECT * FROM bookings WHERE id = :id`, { id: result.insertId });
  return ok(res, { booking: rows[0] }, 'Booking created', 201);
});

// POST /bookings/:id/pay - starts a card payment on Moyasar's hosted page.
// `payment_required: false` means payments are switched off (development).
const payBooking = asyncHandler(async (req, res) => {
  const [booking] = await query(`SELECT * FROM bookings WHERE id = :id AND client_user_id = :uid`, { id: req.params.id, uid: req.user.id });
  if (!booking) return fail(res, 'Booking not found', 404);
  if (booking.status !== 'pending_payment') return fail(res, `This booking is already ${booking.status}`, 409);
  if (!moyasar.moyasarConfigured() || Number(booking.amount) <= 0) return ok(res, { payment_required: false });
  try {
    const invoice = await moyasar.createInvoice({
      amount: booking.amount,
      currency: booking.currency,
      description: `Nafs session booking #${booking.id}`,
      successUrl: `${env.app.url}/api/v1/payments/return?booking=${booking.id}`,
      backUrl: `${env.app.url}/api/v1/payments/return?booking=${booking.id}&cancelled=1`,
      metadata: { booking_id: String(booking.id) },
    });
    await query(`UPDATE bookings SET payment_invoice_id = :iid WHERE id = :id`, { iid: invoice.id, id: booking.id });
    return ok(res, { payment_required: true, pay_url: invoice.url, return_path: '/api/v1/payments/return' });
  } catch (err) {
    return fail(res, `Could not start the payment: ${err.message}`, 502);
  }
});

// GET /payments/return - the page Moyasar redirects to after paying; the app's webview watches for it.
const paymentReturn = (req, res) =>
  res.type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:48px">` +
      `<h2>${req.query.cancelled ? 'Payment cancelled' : 'Payment received'}</h2><p>You can return to the Nafs app.</p></body>`
  );

const checkout = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM bookings WHERE id = :id AND client_user_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!rows.length) return fail(res, 'Booking not found', 404);
  const booking = rows[0];
  if (booking.status !== 'pending_payment') return fail(res, `This booking is already ${booking.status}`, 409);

  // With payments on, the booking is only confirmed once Moyasar says it was paid in full.
  let paymentId = null;
  if (moyasar.moyasarConfigured() && Number(booking.amount) > 0) {
    if (!booking.payment_invoice_id) return fail(res, 'Pay for this booking before confirming it.', 402);
    let invoice;
    try {
      invoice = await moyasar.getInvoice(booking.payment_invoice_id);
    } catch (err) {
      return fail(res, `Could not verify the payment: ${err.message}`, 502);
    }
    const payment = (invoice.payments || []).find((p) => p.status === 'paid');
    if (invoice.status !== 'paid' || !payment || Number(invoice.amount) !== moyasar.toMinor(booking.amount) || invoice.currency !== booking.currency) {
      return fail(res, 'Payment not completed yet.', 402);
    }
    paymentId = payment.id;
  }

  const dateStr = booking.booking_date instanceof Date
    ? booking.booking_date.toISOString().slice(0, 10)
    : String(booking.booking_date).slice(0, 10);
  const timeStr = String(booking.booking_time).slice(0, 8);
  // Booking date/time are the therapist's wall clock; sessions are stored in UTC.
  const [tpz] = await query(`SELECT timezone, session_duration_minutes FROM therapist_profiles WHERE user_id = :id`, { id: booking.therapist_id });
  const starts = toMysqlUtc(zonedToUtc(dateStr, timeStr, tpz?.timezone || 'Asia/Riyadh'));
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

  const minutes = Number(tpz?.session_duration_minutes) || 50;
  const endsSql = await query(`SELECT DATE_ADD(:starts, INTERVAL :minutes MINUTE) AS ends`, { starts, minutes });
  const session = await query(
    `INSERT INTO sessions
      (therapist_id, client_id, title, session_type, status, starts_at, ends_at, duration_minutes, fee_amount, currency, join_url)
     VALUES (:tid, :cid, 'Booked session', :stype, 'scheduled', :starts, :ends, :minutes, :amount, :currency, NULL)`,
    {
      tid: booking.therapist_id,
      cid: clients[0].id,
      stype: booking.session_type,
      starts,
      ends: endsSql[0].ends,
      minutes,
      amount: booking.amount,
      currency: booking.currency,
    }
  );

  await query(
    `UPDATE bookings SET status = 'confirmed', session_id = :sid, payment_id = :pid, payment_method = COALESCE(:pm, payment_method)
     WHERE id = :id`,
    { sid: session.insertId, pid: paymentId, pm: req.body.payment_method || null, id: booking.id }
  );
  const updated = await query(`SELECT * FROM bookings WHERE id = :id`, { id: booking.id });
  const [clientUser] = await query(`SELECT full_name FROM users WHERE id = :uid`, { uid: req.user.id });
  await notify(booking.therapist_id, {
    title: 'New booking',
    body: `${clientUser?.full_name || 'A client'} booked a session on ${dateStr} at ${timeStr.slice(0, 5)}.`,
    type: 'booking',
    category: 'client_bookings',
  });
  await notify(req.user.id, {
    title: 'Booking confirmed',
    body: `Your session on ${dateStr} at ${timeStr.slice(0, 5)} is confirmed.`,
    type: 'booking',
    category: 'client_bookings',
  });
  return ok(res, { booking: updated[0], session_id: session.insertId }, 'Booking confirmed');
});

async function ownBooking(req) {
  const [b] = await query(`SELECT * FROM bookings WHERE id = :id AND client_user_id = :uid`, { id: req.params.id, uid: req.user.id });
  return b;
}

// GET /bookings/:id/cancel-preview - what cancelling now would cost / refund.
const cancelPreview = asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  if (!booking) return fail(res, 'Booking not found', 404);
  if (!['pending_payment', 'confirmed'].includes(booking.status)) return fail(res, `This booking is already ${booking.status}`, 400);
  return ok(res, { preview: await previewCancellation(booking, 'client') });
});

// POST /bookings/:id/cancel - the client cancels; the cancellation policy decides the refund.
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await ownBooking(req);
  if (!booking) return fail(res, 'Booking not found', 404);
  if (!['pending_payment', 'confirmed'].includes(booking.status)) return fail(res, `This booking is already ${booking.status}`, 400);
  const outcome = await settleCancellation(booking, 'client');
  return ok(res, { outcome }, 'Booking cancelled');
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

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const getSpecialistAvailability = asyncHandler(async (req, res) => {
  const therapistId = req.params.id;
  const therapists = await query(`SELECT id FROM users WHERE id = :id AND role = 'therapist'`, {
    id: therapistId,
  });
  if (!therapists.length) return fail(res, 'Specialist not found', 404);

  let days = parseInt(req.query.days, 10);
  if (!Number.isFinite(days) || days < 1) days = 5;
  if (days > 14) days = 14;

  let start;
  if (req.query.from) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(req.query.from))) {
      return fail(res, 'Query from must be an ISO date (YYYY-MM-DD)', 422);
    }
    start = new Date(`${String(req.query.from).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return fail(res, 'Invalid from date', 422);
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }

  const dayList = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    dayList.push({ iso: d.toISOString().slice(0, 10), weekday: d.getUTCDay() });
  }
  const firstDate = dayList[0].iso;
  const lastDate = dayList[dayList.length - 1].iso;

  const slots = await query(
    `SELECT id, weekday, start_time, end_time, is_active
     FROM availability_slots
     WHERE therapist_id = :tid AND is_active = 1
     ORDER BY weekday, start_time`,
    { tid: therapistId }
  );
  const timesByDay = await bookableTimes(therapistId, dayList);
  const result = dayList.map(({ iso, weekday }) => ({
    date: iso,
    weekday,
    weekday_name: WEEKDAY_NAMES[weekday],
    times: timesByDay.get(iso),
  }));

  return ok(res, { slots, days: result });
});

module.exports = {
  createSchema,
  listSpecialists,
  getSpecialist,
  getSpecialistAvailability,
  createBooking,
  checkout,
  myBookings,
  cancelPreview,
  cancelBooking,
  payBooking,
  paymentReturn,
};
