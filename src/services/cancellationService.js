const { query, withTransaction } = require('../config/db');
const { netAmount, LATE_CANCEL_HOURS, COMPENSATION_PERCENT } = require('../config/fees');
const { notify } = require('../utils/notify');
const { wallClock } = require('../utils/time');
const moyasar = require('./moyasarService');
const stripe = require('./stripeService');

/** Hours from now until the booking starts (booking date/time are in the therapist's timezone). */
async function hoursUntil(booking) {
  const [tp] = await query(`SELECT timezone FROM therapist_profiles WHERE user_id = :id`, { id: booking.therapist_id });
  const tz = tp?.timezone || 'Asia/Riyadh';
  const date = booking.booking_date instanceof Date ? booking.booking_date.toISOString().slice(0, 10) : String(booking.booking_date).slice(0, 10);
  const start = new Date(`${date}T${String(booking.booking_time).slice(0, 8)}Z`);
  const now = new Date(`${wallClock(new Date(), tz).replace(' ', 'T')}Z`); // both as "naive" times in the same zone
  return (start.getTime() - now.getTime()) / 3600000;
}

/**
 * What cancelling this booking would cost, per the cancellation policy.
 * `who` = 'client' | 'therapist'. A therapist cancelling always refunds the client in full.
 */
async function previewCancellation(booking, who) {
  const amount = Number(booking.amount) || 0;
  const paid = booking.status === 'confirmed';
  if (!paid || amount <= 0) {
    return { paid, late: false, refund: 0, compensation: 0, currency: booking.currency, message: 'No payment has been taken, so there is nothing to refund.' };
  }
  const late = who === 'client' && (await hoursUntil(booking)) < LATE_CANCEL_HOURS;
  if (!late) {
    return { paid, late: false, refund: amount, compensation: 0, currency: booking.currency, message: `You will be refunded ${amount} ${booking.currency} in full${booking.payment_id ? ' to your card' : ''}.` };
  }
  const refund = Math.round(amount * (100 - COMPENSATION_PERCENT)) / 100;
  const compensation = Math.round(netAmount(amount) * COMPENSATION_PERCENT) / 100;
  return {
    paid, late: true, refund, compensation, currency: booking.currency,
    message: `This is within ${LATE_CANCEL_HOURS} hours of the session, so ${COMPENSATION_PERCENT}% goes to your therapist. You will be refunded ${refund} ${booking.currency}${booking.payment_id ? ' to your card' : ''}.`,
  };
}

async function ensureWalletConn(conn, userId, currency) {
  const [[w]] = await conn.execute(`SELECT id FROM wallets WHERE user_id = :uid FOR UPDATE`, { uid: userId });
  if (w) return w.id;
  const [ins] = await conn.execute(`INSERT INTO wallets (user_id, balance, currency) VALUES (:uid, 0, :cur)`, { uid: userId, cur: currency });
  return ins.insertId;
}

/**
 * Cancels a booking (and its session), refunds the client's wallet and pays
 * the therapist any late-cancellation compensation, all in one transaction.
 */
async function cancelBooking(booking, who) {
  const preview = await previewCancellation(booking, who);
  // A booking paid by card is refunded to the card; if that fails the money goes
  // to the client's in-app wallet instead so it is never lost.
  let refundedToCard = false;
  if (preview.refund > 0 && booking.payment_id) {
    try {
      if (stripe.isStripePaymentId(booking.payment_id) && stripe.stripeConfigured()) {
        await stripe.refundPayment(booking.payment_id, preview.refund);
        refundedToCard = true;
      } else if (moyasar.moyasarConfigured()) {
        await moyasar.refundPayment(booking.payment_id, preview.refund);
        refundedToCard = true;
      }
    } catch (err) {
      console.error(`[refund] card refund failed for booking ${booking.id}: ${err.message}`);
    }
  }
  await withTransaction(async (conn) => {
    await conn.execute(`UPDATE bookings SET status = 'cancelled' WHERE id = :id`, { id: booking.id });
    if (booking.session_id) {
      await conn.execute(`UPDATE sessions SET status = 'cancelled' WHERE id = :id`, { id: booking.session_id });
    }
    if (preview.refund > 0) {
      const wid = await ensureWalletConn(conn, booking.client_user_id, booking.currency);
      // Card refunds are recorded in the ledger but do not touch the wallet balance.
      if (!refundedToCard) await conn.execute(`UPDATE wallets SET balance = balance + :a WHERE id = :id`, { a: preview.refund, id: wid });
      await conn.execute(
        `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, currency, status, description, reference_type, reference_id)
         VALUES (:wid, :uid, 'refund', :a, :cur, 'completed', :descr, 'booking', :bid)`,
        { wid, uid: booking.client_user_id, a: preview.refund, cur: booking.currency, descr: refundedToCard ? 'Booking cancelled - refunded to your card' : 'Booking cancelled - refund', bid: booking.id }
      );
    }
    if (preview.compensation > 0) {
      const wid = await ensureWalletConn(conn, booking.therapist_id, booking.currency);
      await conn.execute(`UPDATE wallets SET balance = balance + :a WHERE id = :id`, { a: preview.compensation, id: wid });
      await conn.execute(
        `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, currency, status, description, reference_type, reference_id)
         VALUES (:wid, :uid, 'credit', :a, :cur, 'completed', 'Late cancellation compensation', 'booking', :bid)`,
        { wid, uid: booking.therapist_id, a: preview.compensation, cur: booking.currency, bid: booking.id }
      );
    }
  });
  if (who === 'client') {
    await notify(booking.therapist_id, {
      title: 'Booking cancelled',
      body: preview.compensation > 0
        ? `A client cancelled within ${LATE_CANCEL_HOURS} hours. ${preview.compensation} ${booking.currency} was added to your wallet.`
        : 'A client cancelled an upcoming booking.',
      type: 'booking',
      category: 'client_bookings',
    });
  } else {
    await notify(booking.client_user_id, {
      title: 'Appointment cancelled',
      body: preview.refund > 0
        ? `Your therapist cancelled. ${preview.refund} ${booking.currency} was refunded to your wallet.`
        : 'Your therapist cancelled your appointment.',
      type: 'booking',
      category: 'client_bookings',
    });
  }
  return preview;
}

module.exports = { previewCancellation, cancelBooking };
