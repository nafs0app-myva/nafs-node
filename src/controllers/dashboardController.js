const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

function parseJsonField(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function moodStreak(userId) {
  const days = await query(
    `SELECT DISTINCT DATE(checked_in_at) AS d
     FROM mood_checkins
     WHERE user_id = :uid
     ORDER BY d DESC
     LIMIT 60`,
    { uid: userId }
  );
  if (!days.length) return 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days.length; i += 1) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    const rowDate = new Date(days[i].d);
    rowDate.setHours(0, 0, 0, 0);
    if (rowDate.getTime() === expected.getTime()) streak += 1;
    else break;
  }
  return streak;
}

async function therapistDashboard(uid, user) {
  const upcoming = await query(
    `SELECT s.id, s.title, s.session_type, s.status, s.starts_at, s.ends_at, s.join_url, s.fee_amount,
            c.id AS client_id, c.full_name AS client_name, c.avatar_url AS client_avatar
     FROM sessions s
     JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.therapist_id = :uid AND s.status = 'scheduled' AND s.starts_at >= NOW()
     ORDER BY s.starts_at ASC LIMIT 3`,
    { uid }
  );
  const todayCount = await query(
    `SELECT COUNT(*) AS count FROM sessions
     WHERE therapist_id = :uid AND DATE(starts_at) = CURDATE()`,
    { uid }
  );
  const completedToday = await query(
    `SELECT COUNT(*) AS count FROM sessions
     WHERE therapist_id = :uid AND status = 'completed' AND DATE(starts_at) = CURDATE()`,
    { uid }
  );
  const clientsCount = await query(
    `SELECT COUNT(*) AS count FROM therapist_clients WHERE therapist_id = :uid AND status = 'active'`,
    { uid }
  );
  const [wallet] = await query(`SELECT balance, currency FROM wallets WHERE user_id = :uid`, {
    uid,
  });
  const weekEarnings = await query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM wallet_transactions
     WHERE user_id = :uid AND type = 'session_fee' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    { uid }
  );
  const unread = await query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = :uid AND is_read = 0`,
    { uid }
  );
  const [app] = await query(`SELECT status, step FROM therapist_applications WHERE user_id = :uid`, {
    uid,
  });
  const [onboarding] = await query(
    `SELECT completed, step FROM user_onboarding WHERE user_id = :uid`,
    { uid }
  );

  const sessionsToday = Number(todayCount[0]?.count || 0);
  const doneToday = Number(completedToday[0]?.count || 0);

  return {
    role: 'therapist',
    greeting_name: user.full_name || 'Doctor',
    application_status: app?.status || null,
    onboarding_completed: !!onboarding?.completed,
    onboarding_step: onboarding?.step || null,
    next_session: upcoming[0] || null,
    upcoming_sessions: upcoming,
    today_tasks: [
      {
        key: 'sessions',
        title: 'Complete today’s sessions',
        done: sessionsToday > 0 && doneToday >= sessionsToday,
        progress: { current: doneToday, total: sessionsToday },
      },
      {
        key: 'availability',
        title: 'Review availability',
        done: false,
      },
      {
        key: 'notes',
        title: 'Add session notes',
        done: doneToday > 0,
      },
    ],
    stats: {
      sessions_today: sessionsToday,
      sessions_completed_today: doneToday,
      active_clients: Number(clientsCount[0]?.count || 0),
      wallet_balance: Number(wallet?.balance || 0),
      earnings_7d: Number(weekEarnings[0]?.total || 0),
      currency: wallet?.currency || 'SAR',
      unread_notifications: Number(unread[0]?.count || 0),
    },
  };
}

async function clientDashboard(uid, user) {
  const streak = await moodStreak(uid);
  const todayMood = await query(
    `SELECT id, mood, intensity, note, checked_in_at
     FROM mood_checkins
     WHERE user_id = :uid AND DATE(checked_in_at) = CURDATE()
     ORDER BY checked_in_at DESC LIMIT 1`,
    { uid }
  );
  const upcoming = await query(
    `SELECT b.id, b.booking_date, b.booking_time, b.session_type, b.status, b.amount, b.currency,
            u.id AS therapist_id, u.full_name AS therapist_name, u.avatar_url AS therapist_avatar
     FROM bookings b
     JOIN users u ON u.id = b.therapist_id
     WHERE b.client_user_id = :uid
       AND b.status IN ('confirmed','pending_payment')
       AND CONCAT(b.booking_date, ' ', b.booking_time) >= NOW()
     ORDER BY b.booking_date ASC, b.booking_time ASC
     LIMIT 3`,
    { uid }
  );
  const journalWeek = await query(
    `SELECT COUNT(*) AS count FROM journal_entries
     WHERE user_id = :uid AND entry_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    { uid }
  );
  const goals = await query(`SELECT goals FROM user_goals WHERE user_id = :uid`, { uid });
  const unread = await query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = :uid AND is_read = 0`,
    { uid }
  );
  const [profile] = await query(
    `SELECT onboarding_completed FROM client_profiles WHERE user_id = :uid`,
    { uid }
  );
  const [onboarding] = await query(
    `SELECT completed, step FROM user_onboarding WHERE user_id = :uid`,
    { uid }
  );
  const openAssessments = await query(
    `SELECT COUNT(*) AS count FROM assessments
     WHERE user_id = :uid AND status = 'in_progress'`,
    { uid }
  );

  const moodDone = !!todayMood[0];
  const journalToday = await query(
    `SELECT COUNT(*) AS count FROM journal_entries
     WHERE user_id = :uid AND entry_date = CURDATE()`,
    { uid }
  );
  const journalDone = Number(journalToday[0]?.count || 0) > 0;

  return {
    role: 'client',
    greeting_name: user.full_name || 'there',
    onboarding_completed: !!(profile?.onboarding_completed || onboarding?.completed),
    onboarding_step: onboarding?.step || null,
    mood_streak: streak,
    today_mood: todayMood[0] || null,
    next_session: upcoming[0] || null,
    upcoming_sessions: upcoming,
    goals: goals[0] ? parseJsonField(goals[0].goals) : [],
    today_tasks: [
      {
        key: 'mood_checkin',
        title: 'Log today’s mood',
        done: moodDone,
      },
      {
        key: 'journal',
        title: 'Write a journal entry',
        done: journalDone,
      },
      {
        key: 'session',
        title: 'Upcoming session',
        done: !upcoming.length,
        meta: upcoming[0] || null,
      },
    ],
    stats: {
      mood_streak: streak,
      journal_entries_7d: Number(journalWeek[0]?.count || 0),
      open_assessments: Number(openAssessments[0]?.count || 0),
      unread_notifications: Number(unread[0]?.count || 0),
      upcoming_sessions: upcoming.length,
    },
  };
}

const dashboard = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT id, full_name, avatar_url, role FROM users WHERE id = :id`, {
    id: req.user.id,
  });
  if (!rows.length) return fail(res, 'User not found', 404);
  const user = rows[0];
  const data =
    user.role === 'client'
      ? await clientDashboard(user.id, user)
      : await therapistDashboard(user.id, user);
  return ok(res, data);
});

module.exports = { dashboard };
