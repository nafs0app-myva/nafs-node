const admin = require('firebase-admin');
const fs = require('fs');
const env = require('../config/env');
const { query } = require('../config/db');

let initialized = false;
let initError = null;
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

async function loadServiceAccount() {
  let raw = env.fcm.serviceAccount || process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw && env.fcm.serviceAccountFile && fs.existsSync(env.fcm.serviceAccountFile)) {
    raw = fs.readFileSync(env.fcm.serviceAccountFile, 'utf8');
  }
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_FILE && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE)) {
    raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8');
  }
  if (!raw) {
    if (dbAccountRaw == null) {
      try {
        const [row] = await query(
          `SELECT value_text FROM app_secrets WHERE secret_key = 'fcm_service_account' LIMIT 1`
        );
        dbAccountRaw = row?.value_text || '';
      } catch {
        dbAccountRaw = '';
      }
    }
    raw = dbAccountRaw;
  }
  return raw ? parseServiceAccount(raw) : null;
}

async function ensureFirebase() {
  if (initialized) return;
  if (initError) throw initError;
  try {
    if (admin.apps.length) {
      initialized = true;
      return;
    }
    const sa = await loadServiceAccount();
    if (!sa) {
      const err = new Error('Firebase Auth is not configured (set FCM_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT)');
      err.status = 503;
      initError = err;
      throw err;
    }
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id,
    });
    initialized = true;
  } catch (err) {
    if (!err.status) {
      const wrapped = new Error(`Firebase Auth init failed: ${err.message}`);
      wrapped.status = 503;
      initError = wrapped;
      throw wrapped;
    }
    throw err;
  }
}

/**
 * Verify a Firebase ID token from the mobile app.
 * @returns {{ uid, email, emailVerified, name, picture, signInProvider }}
 */
async function verifyIdToken(idToken) {
  await ensureFirebase();
  try {
    const decoded = await admin.auth().verifyIdToken(String(idToken), true);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: !!decoded.email_verified,
      name: decoded.name || null,
      picture: decoded.picture || null,
      signInProvider: decoded.firebase?.sign_in_provider || null,
    };
  } catch (err) {
    if (err.status) throw err;
    const bad = new Error('Invalid or expired token');
    bad.status = 401;
    throw bad;
  }
}

function mapProvider(signInProvider) {
  if (signInProvider === 'google.com') return 'google';
  if (signInProvider === 'apple.com') return 'apple';
  return null;
}

module.exports = {
  verifyIdToken,
  mapProvider,
  ensureFirebase,
};
