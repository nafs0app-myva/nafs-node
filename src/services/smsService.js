const env = require('../config/env');

const smsConfigured = () => !!(env.twilio.accountSid && env.twilio.authToken && env.twilio.from);

/** Sends one SMS through Twilio's REST API. */
async function sendSms(to, body) {
  if (!to) return { delivered: false, mode: 'no_phone' };
  if (!smsConfigured()) {
    console.log(`[sms:dev] to=${to} ${body}`);
    return { delivered: false, mode: 'not_configured' };
  }
  const { accountSid, authToken, from } = env.twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
  return { delivered: true, mode: 'sent' };
}

module.exports = { sendSms, smsConfigured };
