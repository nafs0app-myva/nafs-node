const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');
const { ensureSchema } = require('./db/ensureSchema');
const { warmPushFromDb } = require('./services/pushService');
const { warmAgoraFromDb } = require('./services/agoraService');
const { warmStripeFromDb } = require('./services/stripeService');
const { scheduleLicenseExpiryReminders } = require('./jobs/licenseExpiry');

async function start() {
  // Fail fast if DB is unreachable
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  await ensureSchema();
  const pushReady = await warmPushFromDb().catch(() => false);
  console.log(`[push] FCM configured: ${pushReady ? 'yes' : 'no'}`);
  const agoraReady = await warmAgoraFromDb().catch(() => false);
  console.log(`[agora] RTC tokens configured: ${agoraReady ? 'yes' : 'no'}`);
  const { repairTruncatedCheckoutIds } = require('./services/stripeService');
  const stripeReady = await warmStripeFromDb().catch(() => false);
  console.log(`[stripe] payments configured: ${stripeReady ? 'yes' : 'no'}`);
  if (stripeReady) {
    const repaired = await repairTruncatedCheckoutIds().catch((err) => {
      console.warn('[stripe] truncated-id repair skipped:', err.message);
      return 0;
    });
    if (repaired) console.log(`[stripe] repaired ${repaired} truncated checkout session id(s)`);
  }

  scheduleLicenseExpiryReminders();

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`Nafs API listening on http://127.0.0.1:${env.port}`);
    console.log(`API docs: http://127.0.0.1:${env.port}/api/docs`);
    console.log(`Explorer: http://127.0.0.1:${env.port}/`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
