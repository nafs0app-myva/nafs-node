const { query } = require('../config/db');
const { notify } = require('../utils/notify');
const { zonedToUtc, toMysqlUtc } = require('../utils/time');
const fees = require('../config/fees');

/** Payment rails shown on Figma Checkout (Apple Pay / Google Pay / Card). */
const CHECKOUT_METHODS = [
  { id: 'apple_pay', label: 'Apple Pay', icon: 'apple_pay' },
  { id: 'google_pay', label: 'Google Pay', icon: 'google_pay' },
  { id: 'card', label: 'Credit/Debit Card', icon: 'card' },
];

async function loadBookingForClient(bookingId, clientUserId) {
  const [booking] = await query(
    `SELECT b.*, u.full_name AS therapist_name, u.avatar_url AS therapist_avatar,
            p.headline AS therapist_headline, p.session_duration_minutes
     FROM bookings b
     JOIN users u ON u.id = b.therapist_id
     LEFT JOIN therapist_profiles p ON p.user_id = b.therapist_id
     WHERE b.id = :id AND b.client_user_id = :uid`,
    { id: bookingId, uid: clientUserId }
  );
  return booking || null;
}

function formatBookingDate(booking) {
  const dateStr =
    booking.booking_date instanceof Date
      ? booking.booking_date.toISOString().slice(0, 10)
      : String(booking.booking_date).slice(0, 10);
  const timeStr = String(booking.booking_time).slice(0, 8);
  return { dateStr, timeStr };
}

/**
 * Confirm a pending booking after payment (or when payments are disabled).
 * Idempotent: if already confirmed, returns the existing row.
 */
async function confirmPaidBooking(booking, { paymentId = null, paymentMethod = null } = {}) {
  if (booking.status === 'confirmed' || booking.status === 'completed') {
    return { booking, session_id: booking.session_id, already_confirmed: true };
  }
  if (booking.status !== 'pending_payment') {
    const err = new Error(`This booking is already ${booking.status}`);
    err.status = 409;
    throw err;
  }

  const { dateStr, timeStr } = formatBookingDate(booking);
  const [tpz] = await query(`SELECT timezone, session_duration_minutes FROM therapist_profiles WHERE user_id = :id`, {
    id: booking.therapist_id,
  });
  const starts = toMysqlUtc(zonedToUtc(dateStr, timeStr, tpz?.timezone || 'Asia/Riyadh'));

  let clients = await query(
    `SELECT id FROM therapist_clients WHERE therapist_id = :tid AND client_user_id = :uid`,
    { tid: booking.therapist_id, uid: booking.client_user_id }
  );
  if (!clients.length) {
    const [user] = await query(`SELECT full_name, email, phone, avatar_url FROM users WHERE id = :uid`, {
      uid: booking.client_user_id,
    });
    const created = await query(
      `INSERT INTO therapist_clients (therapist_id, client_user_id, full_name, email, phone, avatar_url)
       VALUES (:tid, :uid, :full_name, :email, :phone, :avatar_url)`,
      {
        tid: booking.therapist_id,
        uid: booking.client_user_id,
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

  const breakdown = fees.checkoutBreakdown(booking.amount, booking.currency);
  await query(
    `UPDATE bookings SET status = 'confirmed', session_id = :sid, payment_id = COALESCE(:pid, payment_id),
            payment_method = COALESCE(:pm, payment_method),
            service_fee = :service_fee, total_amount = :total
     WHERE id = :id`,
    {
      sid: session.insertId,
      pid: paymentId,
      pm: paymentMethod,
      service_fee: breakdown.service_fee,
      total: breakdown.total,
      id: booking.id,
    }
  );

  const [updated] = await query(`SELECT * FROM bookings WHERE id = :id`, { id: booking.id });
  const [clientUser] = await query(`SELECT full_name FROM users WHERE id = :uid`, { uid: booking.client_user_id });
  await notify(booking.therapist_id, {
    title: 'New booking',
    body: `${clientUser?.full_name || 'A client'} booked a session on ${dateStr} at ${timeStr.slice(0, 5)}.`,
    type: 'booking',
    category: 'client_bookings',
  });
  await notify(booking.client_user_id, {
    title: 'Booking confirmed',
    body: `Your session on ${dateStr} at ${timeStr.slice(0, 5)} is confirmed.`,
    type: 'booking',
    category: 'client_bookings',
  });

  return { booking: updated, session_id: session.insertId, already_confirmed: false };
}

module.exports = {
  CHECKOUT_METHODS,
  loadBookingForClient,
  formatBookingDate,
  confirmPaidBooking,
};
