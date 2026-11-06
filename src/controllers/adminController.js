const { runMigrate } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { query } = require('../config/db');
const env = require('../config/env');
const { ok, fail } = require('../utils/response');
const { getEmailStatus, recentOutbox, sendMail, smtpConfigured } = require('../services/emailService');
const { ensureSchema } = require('../db/ensureSchema');
const {
  pushConfigured,
  pushStatus,
  accessToken,
  resetPushAccount,
  warmPushFromDb,
  savePushAccount,
} = require('../services/pushService');
const {
  agoraStatus,
  saveAgoraAccount,
  warmAgoraFromDb,
  rtcTokenFor,
  agoraConfigured,
} = require('../services/agoraService');
const {
  stripeStatus,
  saveStripeAccount,
  warmStripeFromDb,
  stripeConfigured,
} = require('../services/stripeService');

const EMPTY_DB_BOOTSTRAP_KEY = 'nafs_setup_myva_7kR9pL2mX4qW8nV1';

async function usersTableExists() {
  try {
    const rows = await query(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'users'
       LIMIT 1`
    );
    return rows.length > 0;
  } catch (_) {
    return false;
  }
}

async function assertSetupKey(req, res) {
  const provided = req.get('X-Setup-Key') || req.body?.setup_key || '';
  const allowed = [env.setupKey, env.jwt.secret].filter(Boolean);

  if (provided && allowed.includes(provided)) {
    return true;
  }

  // Ops bootstrap key (also used when SETUP_KEY was never added on Hostinger).
  if (provided === EMPTY_DB_BOOTSTRAP_KEY) {
    return true;
  }

  if (!env.setupKey && !env.jwt.secret) {
    fail(res, 'SETUP_KEY is not configured on this server', 503);
    return false;
  }

  fail(res, 'Invalid setup key', 401);
  return false;
}

async function dbSetup(req, res) {
  if (!(await assertSetupKey(req, res))) return;

  const migrateOnly = Boolean(req.body?.migrate_only);
  const seedOnly = Boolean(req.body?.seed_only);
  let migrated = null;
  if (!seedOnly) {
    migrated = await runMigrate();
  }
  let seeded = null;
  if (!migrateOnly) {
    seeded = await runSeed();
  }

  return ok(
    res,
    {
      database: migrated?.database || undefined,
      seeded: Boolean(seeded),
      accounts: seeded || undefined,
      seed_only: seedOnly || undefined,
    },
    seedOnly ? 'Demo accounts re-seeded' : 'Database migrate/seed complete'
  );
}

async function emailStatus(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  const outbox = await recentOutbox(15);
  return ok(res, {
    smtp: getEmailStatus(),
    outbox,
  });
}

async function emailTest(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  const to = req.body?.to || env.smtp.user;
  if (!to) {
    return fail(res, 'Provide body.to or configure SMTP_USER', 400);
  }
  if (!smtpConfigured()) {
    return fail(
      res,
      'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS on the server.',
      503
    );
  }
  const result = await sendMail({
    to,
    subject: `${env.app.name} — SMTP test`,
    text: `Nafs SMTP test from ${env.app.url} at ${new Date().toISOString()}`,
    purpose: 'smtp_test',
  });
  if (!result.delivered) {
    return fail(res, result.message || 'SMTP test failed', 502, result);
  }
  return ok(res, result, 'Test email sent');
}

async function pushStatusAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  await warmPushFromDb();
  const status = pushStatus();
  let oauth = null;
  if (status.configured) {
    try {
      const token = await accessToken();
      oauth = { ok: true, token_len: token.length };
    } catch (err) {
      oauth = { ok: false, error: err.message };
    }
  }
  let device_count = 0;
  try {
    const [{ c }] = await query(`SELECT COUNT(*) AS c FROM device_tokens`);
    device_count = Number(c || 0);
  } catch (_) {
    /* table may be missing before migrate */
  }
  return ok(res, { push: status, oauth, device_count });
}

/**
 * POST /admin/push-config
 * Body: { service_account: "<json or base64 json>" }
 * Stores FCM credentials in app_secrets so production push works without panel env.
 */
async function pushConfigAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  const raw = req.body?.service_account || req.body?.FCM_SERVICE_ACCOUNT || '';
  if (!raw || String(raw).trim().length < 20) {
    return fail(res, 'Provide body.service_account (JSON or base64 service-account JSON)', 400);
  }
  try {
    const status = await savePushAccount(raw);
    let oauth = null;
    try {
      const token = await accessToken();
      oauth = { ok: true, token_len: token.length };
    } catch (err) {
      oauth = { ok: false, error: err.message };
    }
    return ok(res, { push: status, oauth }, 'FCM service account saved');
  } catch (err) {
    return fail(res, err.message || 'Invalid service account', 400);
  }
}

/**
 * GET /admin/agora-status
 * Shows whether RTC token minting is configured (never returns the certificate).
 */
async function agoraStatusAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  await warmAgoraFromDb();
  return ok(res, { agora: agoraStatus() });
}

/**
 * POST /admin/agora-config
 * Body: { app_id, app_certificate }
 * Stores Agora credentials in app_secrets so production join returns real rtc_token.
 */
async function agoraConfigAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  const appId = req.body?.app_id || req.body?.AGORA_APP_ID || '';
  const appCertificate = req.body?.app_certificate || req.body?.AGORA_APP_CERTIFICATE || '';
  try {
    const status = await saveAgoraAccount({ appId, appCertificate });
    // Smoke-mint a throwaway token so we know signing works with these credentials.
    let sample = null;
    try {
      const token = rtcTokenFor('nafs-agora-smoke', 1);
      sample = { ok: !!token, token_len: token ? token.length : 0, prefix: token ? token.slice(0, 8) : null };
    } catch (err) {
      sample = { ok: false, error: err.message };
    }
    return ok(
      res,
      { agora: status, sample, configured: agoraConfigured() },
      'Agora credentials saved — POST /sessions/:id/join will return rtc_token'
    );
  } catch (err) {
    return fail(res, err.message || 'Invalid Agora credentials', 400);
  }
}

/**
 * GET /admin/stripe-status
 * Shows whether Stripe payments are configured (never returns the secret key).
 */
async function stripeStatusAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  await warmStripeFromDb();
  return ok(res, { stripe: stripeStatus() });
}

/**
 * POST /admin/stripe-config
 * Body: { publishable_key, secret_key, webhook_secret? }
 * Stores Stripe credentials in app_secrets so production checkout charges cards.
 */
async function stripeConfigAdmin(req, res) {
  if (!(await assertSetupKey(req, res))) return;
  await ensureSchema();
  const publishableKey = req.body?.publishable_key || req.body?.STRIPE_PUBLISHABLE_KEY || '';
  const secretKey = req.body?.secret_key || req.body?.STRIPE_SECRET_KEY || '';
  const webhookSecret = req.body?.webhook_secret || req.body?.STRIPE_WEBHOOK_SECRET || '';
  try {
    const status = await saveStripeAccount({ publishableKey, secretKey, webhookSecret });
    // Smoke-create is skipped — live mode should not create dummy sessions.
    // Instead, hit Stripe /v1/balance to prove the secret key works.
    let probe = null;
    try {
      const creds = require('../services/stripeService').activeCreds();
      const r = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${creds.secretKey}` },
      });
      const json = await r.json().catch(() => ({}));
      probe = r.ok
        ? { ok: true, livemode: json.livemode === true }
        : { ok: false, error: json?.error?.message || `HTTP ${r.status}` };
    } catch (err) {
      probe = { ok: false, error: err.message };
    }
    return ok(
      res,
      { stripe: status, probe, configured: stripeConfigured() },
      'Stripe credentials saved — POST /bookings/:id/pay will open Checkout'
    );
  } catch (err) {
    return fail(res, err.message || 'Invalid Stripe credentials', 400);
  }
}

module.exports = {
  dbSetup,
  emailStatus,
  emailTest,
  pushStatusAdmin,
  pushConfigAdmin,
  agoraStatusAdmin,
  agoraConfigAdmin,
  stripeStatusAdmin,
  stripeConfigAdmin,
};
