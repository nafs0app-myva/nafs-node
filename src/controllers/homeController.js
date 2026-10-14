const { query } = require('../config/db');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const dashboard = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const today = new Date().toISOString().slice(0, 10);

  const [user] = await query(`SELECT id, full_name, avatar_url FROM users WHERE id = :id`, { id: userId });
  const prayers = await query(
    `SELECT prayer_name, status FROM prayer_logs WHERE user_id = :user_id AND prayed_on = :today`,
    { user_id: userId, today }
  );
  const habits = await query(
    `SELECT h.id, h.title, h.target_per_period,
            COALESCE(l.count, 0) AS today_count
     FROM habits h
     LEFT JOIN habit_logs l ON l.habit_id = h.id AND l.logged_on = :today
     WHERE h.user_id = :user_id AND h.is_active = 1
     ORDER BY h.id ASC`,
    { user_id: userId, today }
  );
  const streakRows = await query(
    `SELECT COUNT(DISTINCT prayed_on) AS prayer_days_30
     FROM prayer_logs
     WHERE user_id = :user_id AND prayed_on >= DATE_SUB(:today, INTERVAL 30 DAY)`,
    { user_id: userId, today }
  );
  const tip = await query(
    `SELECT id, kind, title, arabic_text, body, source
     FROM content_items WHERE is_active = 1 ORDER BY RAND() LIMIT 1`
  );
  const activeChallenge = await query(
    `SELECT uc.id, uc.current_day, uc.status, c.title, c.duration_days
     FROM user_challenges uc
     JOIN challenges c ON c.id = uc.challenge_id
     WHERE uc.user_id = :user_id AND uc.status = 'active'
     ORDER BY uc.id DESC LIMIT 1`,
    { user_id: userId }
  );
  const unread = await query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = :user_id AND is_read = 0`,
    { user_id: userId }
  );

  return ok(res, {
    greeting_name: user?.full_name || 'Friend',
    today,
    prayers_today: prayers,
    habits_today: habits,
    stats: {
      prayer_days_last_30: streakRows[0]?.prayer_days_30 || 0,
      unread_notifications: unread[0]?.count || 0,
    },
    daily_content: tip[0] || null,
    active_challenge: activeChallenge[0] || null,
  });
});

module.exports = { dashboard };
