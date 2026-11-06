const { query } = require('../config/db');
const { deleteRecordingRow } = require('../controllers/privacyController');

/**
 * Deletes journal-purpose media that was never attached to an entry
 * (or was detached on edit) and is older than 24 hours.
 */
async function runJournalMediaCleanup() {
  const rows = await query(
    `SELECT id, user_id, file_path, thumbnail_path
     FROM media_recordings
     WHERE purpose = 'journal'
       AND journal_entry_id IS NULL
       AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
     LIMIT 200`
  ).catch(() => []);
  let removed = 0;
  for (const row of rows) {
    try {
      await deleteRecordingRow(row);
      removed += 1;
    } catch (err) {
      console.warn(`[journal-media-cleanup] failed id=${row.id}:`, err.message);
    }
  }
  return removed;
}

function scheduleJournalMediaCleanup() {
  const HOUR = 60 * 60 * 1000;
  setTimeout(() => {
    runJournalMediaCleanup()
      .then((n) => {
        if (n) console.log(`[journal-media-cleanup] removed ${n} orphan upload(s)`);
      })
      .catch((err) => console.warn('[journal-media-cleanup]', err.message));
    setInterval(() => {
      runJournalMediaCleanup()
        .then((n) => {
          if (n) console.log(`[journal-media-cleanup] removed ${n} orphan upload(s)`);
        })
        .catch((err) => console.warn('[journal-media-cleanup]', err.message));
    }, HOUR);
  }, 30 * 1000);
}

module.exports = { runJournalMediaCleanup, scheduleJournalMediaCleanup };
