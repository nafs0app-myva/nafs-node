const { query } = require('../config/db');
const { sendPush } = require('../services/pushService');
const { sendSms } = require('../services/smsService');
const { sendMail } = require('../services/emailService');

/**
 * Creates an in-app notification and fans it out to the user's enabled
 * channels (push / email / SMS from `notification_preferences`).
 *
 * `category` (`client_bookings` | `financial` | `clinical_alerts`) is checked
 * against the user's preferences; when it is switched off nothing is sent.
 * Uncategorised notifications are always delivered. Never throws: a failed
 * notification must not fail the request that caused it, and channel delivery
 * runs in the background.
 */
async function notify(userId, { title, body, type = 'general', category = null, data = {} }) {
  if (!userId) return;
  try {
    const [prefs] = await query(`SELECT * FROM notification_preferences WHERE user_id = :uid`, { uid: userId });
    if (category && prefs && !prefs[category]) return;

    const result = await query(
      `INSERT INTO notifications (user_id, title, body, type, data) VALUES (:uid, :title, :body, :type, :data)`,
      { uid: userId, title, body, type, data: Object.keys(data).length ? JSON.stringify(data) : null }
    );

    // No preferences row yet means the defaults: push + email on, SMS off.
    const wantPush = prefs ? !!prefs.push_channel : true;
    const wantEmail = prefs ? !!prefs.email_channel : true;
    const wantSms = prefs ? !!prefs.sms_channel : false;

    setImmediate(async () => {
      const [user] = await query(`SELECT email, phone FROM users WHERE id = :uid`, { uid: userId }).catch(() => []);
      const jobs = [];
      if (wantPush) jobs.push(sendPush(userId, { title, body, data: { type, notification_id: result.insertId, ...data } }));
      if (wantEmail && user?.email) {
        jobs.push(sendMail({ to: user.email, subject: title, text: body, purpose: 'notification', meta: { type } }));
      }
      if (wantSms && user?.phone) jobs.push(sendSms(user.phone, `${title}: ${body}`));
      const settled = await Promise.allSettled(jobs);
      settled.filter((s) => s.status === 'rejected').forEach((s) => console.error('[notify] channel failed:', s.reason?.message));
    });
  } catch (err) {
    console.error('notify failed', err.message);
  }
}

/** Formats a UTC instant in the user's profile timezone, e.g. "Sat, Nov 14, 10:00 AM". */
async function formatForUser(userId, instant) {
  const env = require('../config/env');
  let timeZone = env.defaultTimezone;
  try {
    const [row] = await query(
      `SELECT COALESCE(cp.timezone, tp.timezone) AS tz FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :uid`,
      { uid: userId }
    );
    if (row?.tz) timeZone = row.tz;
  } catch {
    /* fall back to the default timezone */
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString();
  }
}

module.exports = { notify, formatForUser };
