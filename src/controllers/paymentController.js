const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const fees = require('../config/fees');
const moyasar = require('../services/moyasarService');
const stripe = require('../services/stripeService');
const {
  CHECKOUT_METHODS,
  loadBookingForClient,
  formatBookingDate,
  confirmPaidBooking,
} = require('../services/bookingPaymentService');

const paySchema = Joi.object({
  // Figma Checkout: Apple Pay | Google Pay | Credit/Debit Card
  method: Joi.string().valid('apple_pay', 'google_pay', 'card').default('card'),
  payment_method_id: Joi.number().integer().allow(null),
  // When true and no payment provider is configured (dev), confirm immediately.
  confirm_if_unpaid: Joi.boolean().default(true),
});

function paymentsConfigured() {
  return stripe.stripeConfigured() || moyasar.moyasarConfigured();
}

/** GET /payments/options — rails shown under PAYMENT METHOD on Checkout. */
const paymentOptions = asyncHandler(async (_req, res) => {
  const stripeInfo = stripe.stripeStatus();
  return ok(res, {
    methods: CHECKOUT_METHODS,
    currency_default: 'SAR',
    provider: stripe.stripeConfigured() ? 'stripe' : moyasar.moyasarConfigured() ? 'moyasar' : null,
    stripe_enabled: stripe.stripeConfigured(),
    stripe_publishable_key: stripeInfo.publishable_key || null,
    moyasar_enabled: moyasar.moyasarConfigured(),
    service_fee_percent: fees.CLIENT_SERVICE_FEE_PERCENT,
  });
});

/**
 * GET /bookings/:id/checkout-summary
 * Payload for the Figma Checkout screen (order summary + payment methods + price).
 */
const checkoutSummary = asyncHandler(async (req, res) => {
  const booking = await loadBookingForClient(req.params.id, req.user.id);
  if (!booking) return fail(res, 'Booking not found', 404);

  const { dateStr, timeStr } = formatBookingDate(booking);
  const price = fees.checkoutBreakdown(booking.amount, booking.currency || 'SAR');
  const cards = await query(
    `SELECT id, brand, last4, exp_month, exp_year, is_default, method_type
     FROM payment_methods WHERE user_id = :uid
     ORDER BY is_default DESC, id DESC`,
    { uid: req.user.id }
  );

  const duration = Number(booking.session_duration_minutes) || 50;
  const typeLabel =
    booking.session_type === 'audio'
      ? 'Voice Session'
      : booking.session_type === 'in_person'
        ? 'In-person Session'
        : 'Video Session';

  const stripeInfo = stripe.stripeStatus();
  return ok(res, {
    booking: {
      id: booking.id,
      status: booking.status,
      booking_date: dateStr,
      booking_time: timeStr.slice(0, 5),
      session_type: booking.session_type,
      session_label: `${typeLabel} (${duration} min)`,
      payment_method: booking.payment_method,
      payment_invoice_id: booking.payment_invoice_id,
    },
    therapist: {
      id: booking.therapist_id,
      full_name: booking.therapist_name,
      avatar_url: booking.therapist_avatar,
      headline: booking.therapist_headline,
    },
    payment_methods: CHECKOUT_METHODS,
    saved_cards: cards,
    price_summary: {
      session_fee: price.session_fee,
      service_fee: price.service_fee,
      total: price.total,
      currency: price.currency,
    },
    cta: 'Confirm & Pay',
    provider: stripe.stripeConfigured() ? 'stripe' : moyasar.moyasarConfigured() ? 'moyasar' : null,
    stripe_publishable_key: stripeInfo.publishable_key || null,
    payment_required: paymentsConfigured() && price.total > 0 && booking.status === 'pending_payment',
  });
});

/**
 * POST /bookings/:id/pay — Confirm & Pay.
 * Creates a Stripe Checkout Session (preferred) or Moyasar invoice,
 * or confirms immediately when payments are disabled.
 */
const startPayment = asyncHandler(async (req, res) => {
  const booking = await loadBookingForClient(req.params.id, req.user.id);
  if (!booking) return fail(res, 'Booking not found', 404);
  if (booking.status !== 'pending_payment') {
    return fail(res, `This booking is already ${booking.status}`, 409);
  }

  const method = req.body.method || 'card';
  let savedLabel = method;
  if (req.body.payment_method_id) {
    const [card] = await query(
      `SELECT id, brand, last4 FROM payment_methods WHERE id = :id AND user_id = :uid`,
      { id: req.body.payment_method_id, uid: req.user.id }
    );
    if (!card) return fail(res, 'Saved payment method not found', 404);
    savedLabel = `${card.brand} •••• ${card.last4}`;
  }

  const price = fees.checkoutBreakdown(booking.amount, booking.currency || 'SAR');
  await query(
    `UPDATE bookings SET payment_method = :pm, service_fee = :sf, total_amount = :total WHERE id = :id`,
    { pm: savedLabel, sf: price.service_fee, total: price.total, id: booking.id }
  );

  if (!paymentsConfigured() || price.total <= 0) {
    if (req.body.confirm_if_unpaid === false) {
      return ok(res, {
        payment_required: false,
        price_summary: price,
        method,
        message: 'Payments are disabled; call checkout to confirm without charging.',
      });
    }
    const result = await confirmPaidBooking(
      { ...booking, amount: booking.amount, currency: booking.currency },
      { paymentMethod: savedLabel }
    );
    return ok(res, {
      payment_required: false,
      confirmed: true,
      booking: result.booking,
      session_id: result.session_id,
      price_summary: price,
      method,
    }, 'Booking confirmed');
  }

  // Prefer Stripe when configured.
  if (stripe.stripeConfigured()) {
    try {
      const [client] = await query(`SELECT email FROM users WHERE id = :id`, { id: req.user.id });
      const returnBase = `${env.app.url}/api/v1/payments/return`;
      const session = await stripe.createCheckoutSession({
        amount: price.total,
        currency: price.currency,
        description: `Nafs ${booking.session_type} session #${booking.id}`,
        successUrl: `${returnBase}?booking=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${returnBase}?booking=${booking.id}&cancelled=1`,
        customerEmail: client?.email || undefined,
        metadata: {
          booking_id: String(booking.id),
          method,
          session_fee: String(price.session_fee),
          service_fee: String(price.service_fee),
        },
      });
      await query(`UPDATE bookings SET payment_invoice_id = :iid WHERE id = :id`, {
        iid: session.id,
        id: booking.id,
      });
      return ok(res, {
        payment_required: true,
        provider: 'stripe',
        pay_url: session.url,
        invoice_id: session.id,
        checkout_session_id: session.id,
        return_path: '/api/v1/payments/return',
        price_summary: price,
        method,
        preferred_method: method,
      });
    } catch (err) {
      return fail(res, `Could not start the payment: ${err.message}`, 502);
    }
  }

  try {
    const invoice = await moyasar.createInvoice({
      amount: price.total,
      currency: price.currency,
      description: `Nafs ${booking.session_type} session #${booking.id}`,
      successUrl: `${env.app.url}/api/v1/payments/return?booking=${booking.id}`,
      backUrl: `${env.app.url}/api/v1/payments/return?booking=${booking.id}&cancelled=1`,
      metadata: {
        booking_id: String(booking.id),
        method,
        session_fee: String(price.session_fee),
        service_fee: String(price.service_fee),
      },
    });
    await query(`UPDATE bookings SET payment_invoice_id = :iid WHERE id = :id`, {
      iid: invoice.id,
      id: booking.id,
    });
    return ok(res, {
      payment_required: true,
      provider: 'moyasar',
      pay_url: invoice.url,
      invoice_id: invoice.id,
      return_path: '/api/v1/payments/return',
      price_summary: price,
      method,
      preferred_method: method,
    });
  } catch (err) {
    return fail(res, `Could not start the payment: ${err.message}`, 502);
  }
});

/** GET /payments/return — redirect target for the app webview after Checkout. */
const paymentReturn = (req, res) =>
  res.type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:48px">` +
      `<h2>${req.query.cancelled ? 'Payment cancelled' : 'Payment received'}</h2>` +
      `<p>You can return to the Nafs app.</p>` +
      `<script>try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'payment_return',booking:${JSON.stringify(String(req.query.booking || ''))},cancelled:${req.query.cancelled ? 'true' : 'false'},session_id:${JSON.stringify(String(req.query.session_id || ''))}}))}catch(e){}</script>` +
      `</body>`
  );

/**
 * POST /payments/webhook — Moyasar server-to-server payment events.
 */
const moyasarWebhook = asyncHandler(async (req, res) => {
  const secret = env.moyasar.webhookSecret;
  if (secret) {
    const header = req.get('X-Moyasar-Token') || req.get('Authorization') || '';
    if (header !== secret && header !== `Bearer ${secret}`) {
      return fail(res, 'Invalid webhook token', 401);
    }
  }

  const payload = req.body || {};
  const data = payload.data || payload;
  const meta = data.metadata || {};
  const bookingId = meta.booking_id || req.query.booking;
  const status = data.status || payload.type;
  const paid =
    status === 'paid' ||
    payload.type === 'payment_paid' ||
    payload.type === 'invoice_paid' ||
    (Array.isArray(data.payments) && data.payments.some((p) => p.status === 'paid'));

  if (!bookingId || !paid) {
    return ok(res, { ignored: true });
  }

  const [booking] = await query(`SELECT * FROM bookings WHERE id = :id`, { id: bookingId });
  if (!booking) return ok(res, { ignored: true, reason: 'booking_not_found' });
  if (booking.status !== 'pending_payment') {
    return ok(res, { ignored: true, reason: 'already_settled', status: booking.status });
  }

  const payment =
    (data.payments || []).find((p) => p.status === 'paid') ||
    (data.id && data.status === 'paid' ? data : null);
  const paymentId = payment?.id || data.payment_id || null;

  if (moyasar.moyasarConfigured() && booking.payment_invoice_id && !stripe.isStripeSessionId(booking.payment_invoice_id)) {
    try {
      const invoice = await moyasar.getInvoice(booking.payment_invoice_id);
      const paidPayment = (invoice.payments || []).find((p) => p.status === 'paid');
      const expected = fees.checkoutBreakdown(booking.amount, booking.currency);
      if (
        invoice.status !== 'paid' ||
        !paidPayment ||
        Number(invoice.amount) !== moyasar.toMinor(expected.total) ||
        invoice.currency !== expected.currency
      ) {
        return ok(res, { ignored: true, reason: 'invoice_not_paid' });
      }
      const result = await confirmPaidBooking(booking, {
        paymentId: paidPayment.id,
        paymentMethod: booking.payment_method,
      });
      return ok(res, { confirmed: true, booking_id: result.booking.id, session_id: result.session_id });
    } catch (err) {
      return fail(res, `Webhook verify failed: ${err.message}`, 502);
    }
  }

  const result = await confirmPaidBooking(booking, {
    paymentId,
    paymentMethod: booking.payment_method,
  });
  return ok(res, { confirmed: true, booking_id: result.booking.id, session_id: result.session_id });
});

/**
 * Confirm a booking from a paid Stripe Checkout Session (used by webhook + status poll).
 */
async function confirmFromStripeSession(booking, session) {
  const expected = fees.checkoutBreakdown(booking.amount, booking.currency);
  const paid =
    session.payment_status === 'paid' ||
    session.status === 'complete';
  if (!paid) return { confirmed: false, reason: 'not_paid' };

  const amountOk = Number(session.amount_total) === stripe.toMinor(expected.total);
  const currencyOk = String(session.currency || '').toLowerCase() === String(expected.currency || '').toLowerCase();
  if (!amountOk || !currencyOk) {
    return { confirmed: false, reason: 'amount_mismatch' };
  }

  const pi =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const result = await confirmPaidBooking(booking, {
    paymentId: pi,
    paymentMethod: booking.payment_method,
  });
  return { confirmed: true, booking_id: result.booking.id, session_id: result.session_id };
}

/**
 * POST /payments/stripe/webhook
 * Handles checkout.session.completed / payment_intent.succeeded.
 * Always re-fetches the session from Stripe so forged payloads cannot confirm bookings.
 */
const stripeWebhook = asyncHandler(async (req, res) => {
  if (!stripe.stripeConfigured()) {
    return ok(res, { ignored: true, reason: 'stripe_not_configured' });
  }

  const event = req.body || {};
  const type = event.type || '';
  const obj = event.data?.object || {};

  let sessionId = null;
  let bookingId = obj.metadata?.booking_id || null;

  if (type.startsWith('checkout.session.') || obj.object === 'checkout.session') {
    sessionId = obj.id;
    bookingId = bookingId || obj.metadata?.booking_id || obj.client_reference_id;
  } else if (type.startsWith('payment_intent.') || obj.object === 'payment_intent') {
    bookingId = bookingId || obj.metadata?.booking_id;
  }

  if (!bookingId && !sessionId) {
    return ok(res, { ignored: true, reason: 'no_booking' });
  }

  let booking = null;
  if (bookingId) {
    [booking] = await query(`SELECT * FROM bookings WHERE id = :id`, { id: bookingId });
  }
  if (!booking && sessionId) {
    [booking] = await query(`SELECT * FROM bookings WHERE payment_invoice_id = :sid`, { sid: sessionId });
  }
  if (!booking) return ok(res, { ignored: true, reason: 'booking_not_found' });
  if (booking.status !== 'pending_payment') {
    return ok(res, { ignored: true, reason: 'already_settled', status: booking.status });
  }

  const sid = sessionId || booking.payment_invoice_id;
  if (!sid || !stripe.isStripeSessionId(sid)) {
    return ok(res, { ignored: true, reason: 'no_stripe_session' });
  }

  try {
    const session = await stripe.getCheckoutSession(sid);
    const outcome = await confirmFromStripeSession(booking, session);
    return ok(res, outcome);
  } catch (err) {
    return fail(res, `Stripe webhook verify failed: ${err.message}`, 502);
  }
});

/**
 * GET /payments/:bookingId/status — poll after returning from Checkout webview.
 */
const paymentStatus = asyncHandler(async (req, res) => {
  const booking = await loadBookingForClient(req.params.bookingId, req.user.id);
  if (!booking) return fail(res, 'Booking not found', 404);

  const price = fees.checkoutBreakdown(booking.amount, booking.currency || 'SAR');
  let invoiceStatus = null;
  let invoicePaid = false;

  if (booking.payment_invoice_id && stripe.isStripeSessionId(booking.payment_invoice_id) && stripe.stripeConfigured()) {
    try {
      const session = await stripe.getCheckoutSession(booking.payment_invoice_id);
      invoiceStatus = session.payment_status || session.status;
      invoicePaid = session.payment_status === 'paid';
      if (invoicePaid && booking.status === 'pending_payment') {
        await confirmFromStripeSession(booking, session);
        const [fresh] = await query(`SELECT * FROM bookings WHERE id = :id`, { id: booking.id });
        Object.assign(booking, fresh || {});
      }
    } catch {
      invoiceStatus = null;
    }
  } else if (booking.payment_invoice_id && moyasar.moyasarConfigured()) {
    try {
      const invoice = await moyasar.getInvoice(booking.payment_invoice_id);
      invoiceStatus = invoice.status;
      invoicePaid = invoice.status === 'paid';
    } catch {
      invoiceStatus = null;
    }
  }

  return ok(res, {
    booking_id: booking.id,
    status: booking.status,
    payment_id: booking.payment_id,
    payment_method: booking.payment_method,
    invoice_status: invoiceStatus,
    paid: booking.status === 'confirmed' || booking.status === 'completed' || !!invoicePaid,
    price_summary: price,
    can_checkout:
      booking.status === 'pending_payment' && (!paymentsConfigured() || invoicePaid),
  });
});

module.exports = {
  paySchema,
  paymentOptions,
  checkoutSummary,
  startPayment,
  paymentReturn,
  moyasarWebhook,
  stripeWebhook,
  paymentStatus,
  paymentsConfigured,
  confirmFromStripeSession,
};
