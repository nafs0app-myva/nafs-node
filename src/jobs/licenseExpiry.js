const { query } = require('../config/db');
const { notify } = require('../utils/notify');

// Days before expiry at which a reminder is sent (0 = on / after the expiry date).
const BUCKETS = [30, 14, 7, 1, 0];

/** The tightest bucket the license has reached, or null when it is more than 30 days away. */
function bucketFor(daysLeft) {
  if (daysLeft <= 0) return 0;
  const reached = BUCKETS.filter((b) => b > 0 && daysLeft <= b);
  return reached.length ? Math.min(...reached) : null;
}

/**
 * Reminds therapists whose license is about to expire (or just has). Each
 * license + expiry date + bucket is sent once, so running it repeatedly is safe
 * and a renewed license (new expiry date) starts a fresh cycle.
 */
async function runLicenseExpiryReminders() {
  const licenses = await query(
    `SELECT id, therapist_id, license_number, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry,
            DATEDIFF(expiry_date, CURDATE()) AS days_left
     FROM therapist_licenses
     WHERE expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       AND expiry_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)`
  );
  let sent = 0;
  for (const lic of licenses) {
    const bucket = bucketFor(Number(lic.days_left));
    if (bucket == null) continue;
    const [already] = await query(
      `SELECT id FROM notifications
       WHERE user_id = :uid AND type = 'license_expiry'
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.license_id')) = :lid
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.expiry')) = :expiry
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.bucket')) = :bucket`,
      { uid: lic.therapist_id, lid: String(lic.id), expiry: lic.expiry, bucket: String(bucket) }
    );
    if (already) continue;
    const days = Number(lic.days_left);
    await notify(lic.therapist_id, {
      title: days <= 0 ? 'License expired' : 'License expiring soon',
      body:
        days <= 0
          ? `Your license ${lic.license_number} expired on ${lic.expiry}. Renew it and update your credentials to keep your profile verified.`
          : `Your license ${lic.license_number} expires in ${days} day${days === 1 ? '' : 's'} (${lic.expiry}). Please start your renewal.`,
      type: 'license_expiry', // no category: a lapsed license affects verification, so it ignores the Clinical Alerts switch
      data: { license_id: String(lic.id), expiry: lic.expiry, bucket: String(bucket) },
    });
    sent += 1;
  }
  return sent;
}

/** Runs once shortly after boot, then every 12 hours. */
function scheduleLicenseExpiryReminders() {
  const run = () =>
    runLicenseExpiryReminders()
      .then((n) => n && console.log(`[jobs] license expiry reminders sent: ${n}`))
      .catch((err) => console.error('[jobs] license expiry reminders failed:', err.message));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
}

module.exports = { runLicenseExpiryReminders, scheduleLicenseExpiryReminders };
