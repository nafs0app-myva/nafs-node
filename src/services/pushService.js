const fs = require('fs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/db');

let account;
let cached = { token: null, exp: 0 };

function loadAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    let raw = env.fcm.serviceAccount;
    if (!raw && env.fcm.serviceAccountFile) raw = fs.readFileSync(env.fcm.serviceAccountFile, 'utf8');
    if (raw) {
      if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
      account = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[push] invalid FCM service account:', err.message);
  }
  return account;
}

const pushConfigured = () => !!loadAccount();

async function accessToken() {
  const sa = loadAccount();
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' }
  );
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || 'FCM auth failed');
  cached = { token: json.access_token, exp: now + Number(json.expires_in || 3600) };
  return cached.token;
}

/** Sends a push to every registered device of the user; prunes dead tokens. */
async function sendPush(userId, { title, body, data = {}, dataOnly = false }) {
  if (!pushConfigured()) return { delivered: 0, mode: 'not_configured' };
  const devices = await query(`SELECT id, token FROM device_tokens WHERE user_id = :uid`, { uid: userId });
  if (!devices.length) return { delivered: 0, mode: 'no_devices' };
  const sa = loadAccount();
  const bearer = await accessToken();
  let delivered = 0;
  for (const d of devices) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: d.token,
          // Call signals are data-only and high priority so the app wakes up to ring.
          ...(dataOnly
            ? {
                android: { priority: 'high', ttl: '45s' },
                apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'background' }, payload: { aps: { 'content-available': 1 } } },
              }
            : { notification: { title, body } }),
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        },
      }),
    });
    if (res.ok) {
      delivered += 1;
    } else if (res.status === 404 || res.status === 400) {
      await query(`DELETE FROM device_tokens WHERE id = :id`, { id: d.id }); // unregistered / invalid
    }
  }
  return { delivered, mode: 'sent' };
}

module.exports = { sendPush, pushConfigured };
