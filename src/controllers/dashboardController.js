const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { buildTodayExercises, planProgress } = require('./exerciseController');

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

// Share of the therapist's profile that is filled in, including the
// credentials / specializations / availability sections that live in their
// own tables. `missing` lists the unfinished items for the UI.
async function profileCompletion(uid, user) {
  const [profile] = await query(
    `SELECT bio, years_experience, city, country, gender, date_of_birth, identity_number, session_fee_default
     FROM therapist_profiles WHERE user_id = :uid`,
    { uid }
  );
  const count = async (table, where = '') =>
    Number((await query(`SELECT COUNT(*) AS c FROM ${table} WHERE therapist_id = :uid ${where}`, { uid }))[0]?.c || 0);
  const [licenses, degrees, specs, slots] = await Promise.all([
    count('therapist_licenses'),
    count('therapist_degrees'),
    count('therapist_specializations'),
    count('availability_slots', 'AND is_active = 1'),
  ]);
  const has = (v) => v != null && String(v).trim() !== '';
  const checks = [
    ['name', has(user.full_name)],
    ['bio', has(profile?.bio)],
    ['experience', Number(profile?.years_experience) > 0],
    ['location', has(profile?.city) && has(profile?.country)],
    ['gender', has(profile?.gender) && profile.gender !== 'unspecified'],
    ['date_of_birth', !!profile?.date_of_birth],
    ['identity', has(profile?.identity_number)],
    ['fees', Number(profile?.session_fee_default) > 0],
    ['credentials', licenses + degrees > 0],
    ['specializations', specs > 0],
    ['availability', slots > 0],
  ];
  return {
    percent: Math.round((checks.filter(([, done]) => done).length * 100) / checks.length),
    missing: checks.filter(([, done]) => !done).map(([key]) => key),
  };
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
  const prevWeekEarnings = await query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM wallet_transactions
     WHERE user_id = :uid AND type = 'session_fee'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
       AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    { uid }
  );
  const completedWeek = await query(
    `SELECT COUNT(*) AS count FROM sessions
     WHERE therapist_id = :uid AND status = 'completed'
       AND YEARWEEK(starts_at, 1) = YEARWEEK(CURDATE(), 1)`,
    { uid }
  );
  const unread = await query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = :uid AND is_read = 0`,
    { uid }
  );
  const unreadItems = await query(
    `SELECT id, title, body, created_at FROM notifications
     WHERE user_id = :uid AND is_read = 0 ORDER BY created_at DESC LIMIT 3`,
    { uid }
  );
  const missingNotes = await query(
    `SELECT s.id, s.starts_at, c.full_name AS client_name
     FROM sessions s
     JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.therapist_id = :uid AND s.status = 'completed'
       AND s.starts_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND NOT EXISTS (SELECT 1 FROM session_notes n WHERE n.session_id = s.id)
     ORDER BY s.starts_at DESC LIMIT 3`,
    { uid }
  );
  const [app] = await query(`SELECT status, step FROM therapist_applications WHERE user_id = :uid`, {
    uid,
  });
  const [onboarding] = await query(
    `SELECT completed, step FROM user_onboarding WHERE user_id = :uid`,
    { uid }
  );

  const completion = await profileCompletion(uid, user);
  const sessionsToday = Number(todayCount[0]?.count || 0);
  const doneToday = Number(completedToday[0]?.count || 0);
  const earnings7d = Number(weekEarnings[0]?.total || 0);
  const earningsPrev7d = Number(prevWeekEarnings[0]?.total || 0);
  // null when there is no previous-period baseline to compare against.
  const earningsGrowth =
    earningsPrev7d > 0 ? Math.round(((earnings7d - earningsPrev7d) / earningsPrev7d) * 100) : null;

  const requiresAttention = [];
  if (app?.status && app.status !== 'approved') {
    requiresAttention.push({
      type: 'application',
      title: `Application ${String(app.status).replace(/_/g, ' ')}`,
      subtitle: 'Your therapist application is not yet approved',
    });
  }
  missingNotes.forEach((m) =>
    requiresAttention.push({
      type: 'session_notes',
      title: `Add notes for ${m.client_name}`,
      subtitle: 'Completed session has no notes',
      time: m.starts_at,
      ref_id: m.id,
    })
  );
  unreadItems.forEach((n) =>
    requiresAttention.push({
      type: 'message',
      title: n.title,
      subtitle: n.body,
      time: n.created_at,
      ref_id: n.id,
    })
  );

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
    requires_attention: requiresAttention,
    profile_completion: completion,
    stats: {
      sessions_today: sessionsToday,
      sessions_completed_today: doneToday,
      sessions_completed_week: Number(completedWeek[0]?.count || 0),
      active_clients: Number(clientsCount[0]?.count || 0),
      wallet_balance: Number(wallet?.balance || 0),
      earnings_7d: earnings7d,
      earnings_prev_7d: earningsPrev7d,
      earnings_growth_percent: earningsGrowth,
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

  // Real wellness-exercise plan (same catalogue + done flags as GET /plan/exercises).
  // Kept separate from today_tasks, which tracks mood / journal / session synthetics.
  const todayExercises = await buildTodayExercises(uid);
  const exerciseProgress = planProgress(todayExercises);

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
    today_exercises: todayExercises,
    my_plan: {
      date: new Date().toISOString().slice(0, 10),
      exercises: todayExercises,
      progress: exerciseProgress,
    },
    stats: {
      mood_streak: streak,
      journal_entries_7d: Number(journalWeek[0]?.count || 0),
      open_assessments: Number(openAssessments[0]?.count || 0),
      unread_notifications: Number(unread[0]?.count || 0),
      upcoming_sessions: upcoming.length,
      exercises_done_today: exerciseProgress.done,
      exercises_total_today: exerciseProgress.total,
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
