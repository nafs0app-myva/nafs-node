const { runMigrate } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { query } = require('../config/db');
const env = require('../config/env');
const { ok, fail } = require('../utils/response');
const { getEmailStatus, recentOutbox, sendMail, smtpConfigured } = require('../services/emailService');
const { ensureSchema } = require('../db/ensureSchema');

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

  // One-time empty-DB bootstrap: works only until `users` exists.
  if (provided === EMPTY_DB_BOOTSTRAP_KEY) {
    const exists = await usersTableExists();
    if (!exists) return true;
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
  const migrated = await runMigrate();
  let seeded = null;
  if (!migrateOnly) {
    seeded = await runSeed();
  }

  return ok(
    res,
    {
      database: migrated.database,
      seeded: Boolean(seeded),
      accounts: seeded || undefined,
    },
    'Database migrate/seed complete'
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

module.exports = { dbSetup, emailStatus, emailTest };
