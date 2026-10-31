const env = require('../config/env');

const BASE = 'https://api.moyasar.com/v1';
const moyasarConfigured = () => !!env.moyasar.secretKey;

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.moyasar.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Moyasar ${res.status}`);
  return json;
}

/** Amounts are sent in the smallest unit (halalas for SAR). */
const toMinor = (amount) => Math.round(Number(amount) * 100);

/** Hosted payment page: the customer pays by card / mada / Apple Pay on Moyasar's page. */
const createInvoice = ({ amount, currency, description, successUrl, backUrl, metadata }) =>
  call('POST', '/invoices', {
    amount: toMinor(amount),
    currency,
    description,
    success_url: successUrl,
    back_url: backUrl,
    metadata,
  });

const getInvoice = (id) => call('GET', `/invoices/${encodeURIComponent(id)}`);

/** Refunds `amount` (a partial amount is allowed) of a paid payment back to the card. */
const refundPayment = (paymentId, amount) =>
  call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: toMinor(amount) });

module.exports = { moyasarConfigured, createInvoice, getInvoice, refundPayment, toMinor };
