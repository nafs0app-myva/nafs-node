const env = require('../config/env');
const { query } = require('../config/db');

const API = 'https://api.stripe.com/v1';

/** Credentials loaded from MySQL app_secrets (survives Hostinger redeploys). */
let dbCreds = null; // { publishableKey, secretKey, webhookSecret } | null

function envCreds() {
  const publishableKey = (env.stripe.publishableKey || '').trim();
  const secretKey = (env.stripe.secretKey || '').trim();
  const webhookSecret = (env.stripe.webhookSecret || '').trim();
  if (!secretKey) return null;
  return { publishableKey, secretKey, webhookSecret };
}

function activeCreds() {
  return envCreds() || dbCreds;
}

function stripeConfigured() {
  return !!activeCreds()?.secretKey;
}

function stripeStatus() {
  const c = activeCreds();
  return {
    configured: !!c?.secretKey,
    source: envCreds() ? 'env' : dbCreds ? 'app_secrets' : null,
    publishable_key: c?.publishableKey || null,
    publishable_key_prefix: c?.publishableKey ? `${c.publishableKey.slice(0, 12)}…` : null,
    secret_key_prefix: c?.secretKey ? `${c.secretKey.slice(0, 12)}…` : null,
    webhook_configured: !!(c?.webhookSecret),
    live_mode: !!(c?.secretKey && c.secretKey.startsWith('sk_live_')),
  };
}

async function warmStripeFromDb() {
  try {
    const rows = await query(
      `SELECT secret_key, value_text FROM app_secrets
       WHERE secret_key IN ('stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.secret_key, (r.value_text || '').trim()]));
    const publishableKey = map.stripe_publishable_key || '';
    const secretKey = map.stripe_secret_key || '';
    const webhookSecret = map.stripe_webhook_secret || '';
    dbCreds = secretKey ? { publishableKey, secretKey, webhookSecret } : null;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[stripe] warmStripeFromDb:', err.message);
    }
    dbCreds = null;
  }
  return stripeConfigured();
}

async function upsertSecret(key, value) {
  await query(
    `INSERT INTO app_secrets (secret_key, value_text)
     VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), updated_at = CURRENT_TIMESTAMP`,
    { key, value }
  );
}

/**
 * Persist Stripe keys in DB so Hostinger does not need panel env vars.
 */
async function saveStripeAccount({ publishableKey, secretKey, webhookSecret }) {
  const pk = String(publishableKey || '').trim();
  const sk = String(secretKey || '').trim();
  const wh = String(webhookSecret || '').trim();
  if (!sk || (!sk.startsWith('sk_live_') && !sk.startsWith('sk_test_'))) {
    throw new Error('Invalid Stripe secret key (expected sk_live_… or sk_test_…)');
  }
  if (pk && !pk.startsWith('pk_live_') && !pk.startsWith('pk_test_')) {
    throw new Error('Invalid Stripe publishable key (expected pk_live_… or pk_test_…)');
  }

  await upsertSecret('stripe_secret_key', sk);
  if (pk) await upsertSecret('stripe_publishable_key', pk);
  if (wh) await upsertSecret('stripe_webhook_secret', wh);

  const prev = activeCreds() || {};
  dbCreds = {
    publishableKey: pk || prev.publishableKey || '',
    secretKey: sk,
    webhookSecret: wh || prev.webhookSecret || '',
  };
  return stripeStatus();
}

/** Amounts in the smallest currency unit (halalas for SAR, cents for USD). */
const toMinor = (amount) => Math.round(Number(amount) * 100);

async function stripeCall(method, path, body) {
  const creds = activeCreds();
  if (!creds?.secretKey) throw new Error('Stripe is not configured');

  const headers = {
    Authorization: `Bearer ${creds.secretKey}`,
  };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = typeof body === 'string' ? body : new URLSearchParams(body).toString();
  }

  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Nested Stripe form fields: metadata[booking_id]=1 → metadata[booking_id]
 * and line_items[0][price_data][…] for Checkout.
 */
function flattenParams(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}[${key}]` : key;
    if (value == null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      flattenParams(value, path, out);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') flattenParams(item, `${path}[${i}]`, out);
        else out[`${path}[${i}]`] = String(item);
      });
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

/**
 * Hosted Checkout page — card / Apple Pay / Google Pay (when enabled in Stripe).
 * Returns { id, url, payment_intent, … }.
 */
async function createCheckoutSession({
  amount,
  currency,
  description,
  successUrl,
  cancelUrl,
  metadata = {},
  customerEmail,
}) {
  const params = flattenParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: metadata.booking_id || undefined,
    customer_email: customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: String(currency || 'sar').toLowerCase(),
          unit_amount: String(toMinor(amount)),
          product_data: {
            name: description || 'Nafs session',
          },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      metadata,
    },
  });
  return stripeCall('POST', '/checkout/sessions', params);
}

const getCheckoutSession = (id) =>
  stripeCall('GET', `/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent`);

const getPaymentIntent = (id) => stripeCall('GET', `/payment_intents/${encodeURIComponent(id)}`);

/** Refund `amount` (major units) of a PaymentIntent. */
async function refundPayment(paymentIntentId, amount) {
  const params = flattenParams({
    payment_intent: paymentIntentId,
    amount: String(toMinor(amount)),
  });
  return stripeCall('POST', '/refunds', params);
}

function isStripeSessionId(id) {
  return typeof id === 'string' && id.startsWith('cs_');
}

function isStripePaymentId(id) {
  return typeof id === 'string' && (id.startsWith('pi_') || id.startsWith('ch_'));
}

module.exports = {
  stripeConfigured,
  stripeStatus,
  warmStripeFromDb,
  saveStripeAccount,
  createCheckoutSession,
  getCheckoutSession,
  getPaymentIntent,
  refundPayment,
  toMinor,
  isStripeSessionId,
  isStripePaymentId,
  activeCreds,
};
