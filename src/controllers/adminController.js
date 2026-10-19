const { runMigrate } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const env = require('../config/env');
const { ok, fail } = require('../utils/response');

function assertSetupKey(req, res) {
  // Prefer SETUP_KEY; fall back to JWT_SECRET so existing Hostinger env works
  // without requiring a panel update before first migrate/seed.
  const expected = env.setupKey || env.jwt.secret;
  if (!expected) {
    fail(res, 'SETUP_KEY is not configured on this server', 503);
    return false;
  }
  const provided = req.get('X-Setup-Key') || req.body?.setup_key || '';
  if (provided !== expected) {
    fail(res, 'Invalid setup key', 401);
    return false;
  }
  return true;
}

async function dbSetup(req, res) {
  if (!assertSetupKey(req, res)) return;

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

module.exports = { dbSetup };
