const fs = require('fs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/db');

let account;
let cached = { token: null, exp: 0 };
/** Raw JSON / base64 loaded from `app_secrets` (survives Hostinger redeploys). */
let dbAccountRaw = null;

function parseServiceAccount(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa?.project_id || !sa?.private_key || !sa?.client_email) {
    throw new Error('service account missing project_id / client_email / private_key');
  }
  return sa;
}

function loadAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    let raw = env.fcm.serviceAccount;
    if (!raw && env.fcm.serviceAccountFile && fs.existsSync(env.fcm.serviceAccountFile)) {
      raw = fs.readFileSync(env.fcm.serviceAccountFile, 'utf8');
    }
    if (!raw && dbAccountRaw) raw = dbAccountRaw;
    if (raw) account = parseServiceAccount(raw);
  } catch (err) {
    console.warn('[push] invalid FCM service account:', err.message);
    account = null;
  }
  return account;
}

/** Reset cached credentials (e.g. after admin reload). */
function resetPushAccount() {
  account = undefined;
  cached = { token: null, exp: 0 };
}

/** Load FCM service account JSON/base64 from MySQL app_secrets into memory. */
async function warmPushFromDb() {
  try {
    const [row] = await query(
      `SELECT value_text FROM app_secrets WHERE secret_key = 'fcm_service_account' LIMIT 1`
    );
    dbAccountRaw = row?.value_text || null;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[push] warmPushFromDb:', err.message);
    }
    dbAccountRaw = null;
  }
  resetPushAccount();
  return pushConfigured();
}

/**
 * Persist FCM credentials in DB so Hostinger does not need panel env vars.
 * `raw` may be JSON or base64 JSON.
 */
async function savePushAccount(raw) {
  const sa = parseServiceAccount(raw);
  // Store as compact JSON (private_key keeps real newlines).
  const value = JSON.stringify(sa);
  await query(
    `INSERT INTO app_secrets (secret_key, value_text)
     VALUES ('fcm_service_account', :value)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), updated_at = CURRENT_TIMESTAMP`,
    { value }
  );
  dbAccountRaw = value;
  resetPushAccount();
  return pushStatus();
}

const pushConfigured = () => !!loadAccount();

function pushStatus() {
  const sa = loadAccount();
  return {
    configured: !!sa,
    project_id: sa?.project_id || null,
    client_email: sa?.client_email || null,
    source: env.fcm.serviceAccount
      ? 'env'
      : env.fcm.serviceAccountFile && fs.existsSync(env.fcm.serviceAccountFile)
        ? 'file'
        : dbAccountRaw
          ? 'database'
          : null,
  };
}

async function accessToken() {
  const sa = loadAccount();
  if (!sa) throw new Error('FCM not configured');
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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'FCM auth failed');
  cached = { token: json.access_token, exp: now + Number(json.expires_in || 3600) };
  return cached.token;
}

function buildMessage(token, { title, body, data = {}, dataOnly = false }) {
  const stringData = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, v == null ? '' : String(v)])
  );
  const message = {
    token,
    data: stringData,
    android: { priority: 'high' },
  };
  if (dataOnly) {
    message.android.ttl = '45s';
    message.apns = {
      headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
      payload: { aps: { 'content-available': 1 } },
    };
  } else {
    message.notification = { title: title || 'Nafs', body: body || '' };
    message.apns = {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default', 'content-available': 1 } },
    };
  }
  return { message };
}

/**
 * Sends a push to every registered device of the user; prunes dead tokens.
 * Returns { delivered, mode, devices, errors[] }.
 */
async function sendPush(userId, { title, body, data = {}, dataOnly = false }) {
  if (!pushConfigured()) {
    // One lazy warm in case startup missed the table.
    await warmPushFromDb();
  }
  if (!pushConfigured()) {
    console.warn('[push] skip — FCM not configured (env / file / app_secrets)');
    return { delivered: 0, mode: 'not_configured', devices: 0, errors: [] };
  }
  const devices = await query(`SELECT id, token, platform FROM device_tokens WHERE user_id = :uid`, {
    uid: userId,
  });
  if (!devices.length) {
    console.warn(`[push] skip — no device_tokens for user ${userId}`);
    return { delivered: 0, mode: 'no_devices', devices: 0, errors: [] };
  }

  const sa = loadAccount();
  let bearer;
  try {
    bearer = await accessToken();
  } catch (err) {
    console.error('[push] FCM OAuth failed:', err.message);
    return { delivered: 0, mode: 'auth_failed', devices: devices.length, errors: [{ error: err.message }] };
  }

  let delivered = 0;
  const errors = [];
  for (const d of devices) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMessage(d.token, { title, body, data, dataOnly })),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        delivered += 1;
      } else {
        const code = json?.error?.details?.[0]?.errorCode || json?.error?.status || String(res.status);
        const msg = json?.error?.message || res.statusText || 'FCM send failed';
        console.error(`[push] send failed user=${userId} device=${d.id} platform=${d.platform}:`, code, msg);
        errors.push({ device_id: d.id, platform: d.platform, status: res.status, code, message: msg });
        if (
          res.status === 404 ||
          res.status === 400 ||
          code === 'UNREGISTERED' ||
          code === 'INVALID_ARGUMENT'
        ) {
          await query(`DELETE FROM device_tokens WHERE id = :id`, { id: d.id });
        }
      }
    } catch (err) {
      console.error(`[push] network error device=${d.id}:`, err.message);
      errors.push({ device_id: d.id, platform: d.platform, message: err.message });
    }
  }
  return {
    delivered,
    mode: delivered > 0 ? 'sent' : 'failed',
    devices: devices.length,
    errors,
  };
}

module.exports = {
  sendPush,
  pushConfigured,
  pushStatus,
  resetPushAccount,
  accessToken,
  warmPushFromDb,
  savePushAccount,
};
