const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { consentEnabled } = require('./privacyController');
const { findExercise } = require('./exerciseController');
const {
  WEEKDAYS,
  moodScore,
  labelForScore,
  matchCause,
  matchSymptom,
  parseTags,
} = require('../constants/progress');

const insightSchema = Joi.object({
  period: Joi.string().valid('weekly', 'monthly').required(),
  period_start: Joi.date().iso().required(),
  summary: Joi.string().trim().min(1).max(4000).required(),
  direction: Joi.string().trim().min(1).max(2000).required(),
  stability: Joi.string().trim().min(1).max(2000).required(),
});

/**
 * Convert a UTC Date to the user's local calendar day / weekday using tz_offset
 * minutes east of UTC (app sends e.g. 180 for Riyadh).
 */
function localParts(utcDate, tzOffsetMinutes) {
  const ms = utcDate.getTime() + Number(tzOffsetMinutes || 0) * 60 * 1000;
  const local = new Date(ms);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    weekday: WEEKDAYS[local.getUTCDay()],
  };
}

function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Inclusive local date range for the period ending on local "today". */
function periodRange(period, tzOffsetMinutes, now = new Date()) {
  const days = period === 'monthly' ? 30 : 7;
  const today = localParts(now, tzOffsetMinutes).date;
  const todayUtcMs = Date.parse(`${today}T00:00:00.000Z`);
  const fromUtcMs = todayUtcMs - (days - 1) * 24 * 60 * 60 * 1000;
  const from = new Date(fromUtcMs).toISOString().slice(0, 10);
  return { from, to: today, days };
}

function previousRange(range) {
  const toMs = Date.parse(`${range.from}T00:00:00.000Z`) - 24 * 60 * 60 * 1000;
  const fromMs = toMs - (range.days - 1) * 24 * 60 * 60 * 1000;
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to: new Date(toMs).toISOString().slice(0, 10),
    days: range.days,
  };
}

function eachDate(from, to) {
  const out = [];
  let ms = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  while (ms <= end) {
    out.push(new Date(ms).toISOString().slice(0, 10));
    ms += 24 * 60 * 60 * 1000;
  }
  return out;
}

function weekdayForLocalDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  return WEEKDAYS[d.getUTCDay()];
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function variance(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const sum = nums.reduce((acc, n) => acc + (n - m) ** 2, 0);
  return sum / nums.length;
}

function inLocalRange(localDate, range) {
  return localDate >= range.from && localDate <= range.to;
}

/**
 * End of a local calendar day as a UTC Date, given tz_offset minutes east of UTC.
 * Local 23:59:59.999 → UTC = local - offset.
 */
function endOfLocalDayUtc(localDate, tzOffsetMinutes) {
  const localEndMs = Date.parse(`${localDate}T23:59:59.999Z`);
  return new Date(localEndMs - Number(tzOffsetMinutes || 0) * 60 * 1000);
}

function startOfLocalDayUtc(localDate, tzOffsetMinutes) {
  const localStartMs = Date.parse(`${localDate}T00:00:00.000Z`);
  return new Date(localStartMs - Number(tzOffsetMinutes || 0) * 60 * 1000);
}

function computeMoodStats(checkins, range, tzOffsetMinutes) {
  const scored = [];
  const byWeekday = new Map();
  const byDay = new Map();
  const checkinDays = new Set();

  for (const row of checkins) {
    const at = row.checked_in_at instanceof Date ? row.checked_in_at : new Date(row.checked_in_at);
    if (Number.isNaN(at.getTime())) continue;
    const local = localParts(at, tzOffsetMinutes);
    if (!inLocalRange(local.date, range)) continue;
    const score = moodScore(row.mood);
    if (score == null) continue;

    scored.push({ ...local, score, mood: String(row.mood).trim().toLowerCase() });
    checkinDays.add(local.date);

    if (!byWeekday.has(local.weekday)) byWeekday.set(local.weekday, []);
    byWeekday.get(local.weekday).push(score);

    if (!byDay.has(local.date)) byDay.set(local.date, []);
    byDay.get(local.date).push({ score, mood: String(row.mood).trim().toLowerCase() });
  }

  const scores = scored.map((s) => s.score);
  const avg = mean(scores);
  const average_mood =
    avg == null
      ? null
      : {
          label: labelForScore(avg),
          score: Math.round(avg * 10) / 10,
          checkins: scored.length,
        };

  let best_day = null;
  let difficult_day = null;
  if (byWeekday.size >= 2) {
    const weekdayAvgs = [...byWeekday.entries()].map(([weekday, list]) => ({
      weekday,
      avg_score: Math.round(mean(list) * 10) / 10,
    }));
    weekdayAvgs.sort((a, b) => b.avg_score - a.avg_score || a.weekday.localeCompare(b.weekday));
    const best = weekdayAvgs[0];
    const worst = [...weekdayAvgs].sort(
      (a, b) => a.avg_score - b.avg_score || a.weekday.localeCompare(b.weekday)
    )[0];
    if (best.weekday !== worst.weekday) {
      best_day = { weekday: best.weekday, avg_score: best.avg_score };
      difficult_day = { weekday: worst.weekday, avg_score: worst.avg_score };
    }
  }

  const mood_by_day = eachDate(range.from, range.to)
    .map((date) => {
      const list = byDay.get(date) || [];
      if (!list.length) return null;
      const dayAvg = mean(list.map((x) => x.score));
      const moodCounts = new Map();
      for (const x of list) moodCounts.set(x.mood, (moodCounts.get(x.mood) || 0) + 1);
      const top_mood = [...moodCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
      )[0][0];
      return {
        date,
        weekday: weekdayForLocalDate(date),
        avg_score: Math.round(dayAvg * 10) / 10,
        top_mood,
      };
    })
    .filter(Boolean);

  return {
    average_mood,
    best_day,
    difficult_day,
    mood_by_day,
    mood_variance: Math.round(variance(scores) * 10) / 10,
    avg_score: avg == null ? null : Math.round(avg * 10) / 10,
    checkin_count: scored.length,
    checkin_days: checkinDays.size,
  };
}

function computeTriggersAndSymptoms(checkins, range, tzOffsetMinutes) {
  const triggerCounts = new Map();
  const symptomCounts = new Map();

  for (const row of checkins) {
    const at = row.checked_in_at instanceof Date ? row.checked_in_at : new Date(row.checked_in_at);
    if (Number.isNaN(at.getTime())) continue;
    const local = localParts(at, tzOffsetMinutes);
    if (!inLocalRange(local.date, range)) continue;

    for (const tag of parseTags(row.tags)) {
      const cause = matchCause(tag);
      if (cause) triggerCounts.set(cause, (triggerCounts.get(cause) || 0) + 1);
      const symptom = matchSymptom(tag);
      if (symptom) symptomCounts.set(symptom, (symptomCounts.get(symptom) || 0) + 1);
    }
  }

  const trigger_counts = [...triggerCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const symptom_counts = [...symptomCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  let frequent_trigger = null;
  if (trigger_counts.length) {
    const withoutOther = trigger_counts.filter((t) => t.label !== 'Other Cause');
    const pick = withoutOther.length ? withoutOther[0] : trigger_counts[0];
    frequent_trigger = { label: pick.label, count: pick.count };
  }

  return { frequent_trigger, trigger_counts, symptom_counts };
}

function computePlanCompletion(planRows, completions, range, tzOffsetMinutes) {
  const dates = eachDate(range.from, range.to);
  let scheduled = 0;

  for (const day of dates) {
    const dayEnd = endOfLocalDayUtc(day, tzOffsetMinutes);
    for (const row of planRows) {
      const addedAt = row.added_at instanceof Date ? row.added_at : new Date(row.added_at);
      if (Number.isNaN(addedAt.getTime()) || addedAt > dayEnd) continue;
      const scheduledFor = parseDateOnly(row.scheduled_for);
      if (scheduledFor == null || scheduledFor === day) scheduled += 1;
    }
  }

  const completedKeys = new Set();
  for (const row of completions) {
    const at = row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at);
    if (Number.isNaN(at.getTime())) continue;
    const local = localParts(at, tzOffsetMinutes);
    if (!inLocalRange(local.date, range)) continue;
    completedKeys.add(`${row.exercise_id}|${local.date}`);
  }

  const completed = completedKeys.size;
  if (scheduled === 0) {
    return { plan_completion: null, percent: null, completed, scheduled };
  }
  const percent = Math.min(100, Math.round((completed / scheduled) * 100));
  return {
    plan_completion: { percent, completed, scheduled },
    percent,
    completed,
    scheduled,
  };
}

function computeMostUsed(completions, range, tzOffsetMinutes) {
  const stats = new Map();
  for (const row of completions) {
    const at = row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at);
    if (Number.isNaN(at.getTime())) continue;
    const local = localParts(at, tzOffsetMinutes);
    if (!inLocalRange(local.date, range)) continue;
    const cur = stats.get(row.exercise_id) || { count: 0, latest: 0 };
    cur.count += 1;
    cur.latest = Math.max(cur.latest, at.getTime());
    stats.set(row.exercise_id, cur);
  }

  const exercise_counts = [...stats.entries()]
    .map(([exercise_id, s]) => ({ exercise_id, count: s.count, latest: s.latest }))
    .sort((a, b) => b.count - a.count || b.latest - a.latest || a.exercise_id.localeCompare(b.exercise_id));

  let most_used_exercise = null;
  if (exercise_counts.length) {
    const top = exercise_counts[0];
    const catalog = findExercise(top.exercise_id);
    most_used_exercise = {
      exercise_id: top.exercise_id,
      title: catalog?.title || top.exercise_id,
      count: top.count,
    };
  }

  return {
    most_used_exercise,
    exercise_counts: exercise_counts.map(({ exercise_id, count }) => ({ exercise_id, count })),
  };
}

async function loadProgressInputs(userId) {
  const [checkins, planRows, completions, journalRows] = await Promise.all([
    query(
      `SELECT id, mood, intensity, tags, checked_in_at
       FROM mood_checkins WHERE user_id = :uid ORDER BY checked_in_at ASC`,
      { uid: userId }
    ).catch((err) => {
      if (err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }),
    query(
      `SELECT exercise_id, scheduled_for, added_at, completed_at
       FROM user_exercise_plan WHERE user_id = :uid`,
      { uid: userId }
    ).catch((err) => {
      if (err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }),
    query(
      `SELECT exercise_id, completed_at
       FROM exercise_completions WHERE user_id = :uid ORDER BY completed_at ASC`,
      { uid: userId }
    ).catch((err) => {
      if (err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }),
    query(
      `SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = :uid AND is_locked = 0`,
      { uid: userId }
    ).catch((err) => {
      if (err.code === 'ER_NO_SUCH_TABLE') return [{ c: 0 }];
      throw err;
    }),
  ]);

  return {
    checkins,
    planRows,
    completions,
    journal_entries: Number(journalRows[0]?.c || 0),
  };
}

function buildPeriodSummary(inputs, range, tzOffsetMinutes) {
  const mood = computeMoodStats(inputs.checkins, range, tzOffsetMinutes);
  const tags = computeTriggersAndSymptoms(inputs.checkins, range, tzOffsetMinutes);
  const plan = computePlanCompletion(inputs.planRows, inputs.completions, range, tzOffsetMinutes);
  const exercises = computeMostUsed(inputs.completions, range, tzOffsetMinutes);

  return {
    average_mood: mood.average_mood,
    best_day: mood.best_day,
    difficult_day: mood.difficult_day,
    plan_completion: plan.plan_completion,
    most_used_exercise: exercises.most_used_exercise,
    frequent_trigger: tags.frequent_trigger,
    ai_input: {
      mood_by_day: mood.mood_by_day,
      mood_variance: mood.mood_variance,
      avg_score: mood.avg_score,
      checkin_days: mood.checkin_days,
      checkin_count: mood.checkin_count,
      exercise_counts: exercises.exercise_counts,
      trigger_counts: tags.trigger_counts,
      symptom_counts: tags.symptom_counts,
      journal_entries: inputs.journal_entries,
      plan_percent: plan.percent,
    },
  };
}

const getSummary = asyncHandler(async (req, res) => {
  const period = String(req.query.period || 'weekly').toLowerCase();
  if (period !== 'weekly' && period !== 'monthly') {
    return fail(res, 'period must be weekly or monthly', 422);
  }
  const tzOffset = Number.parseInt(req.query.tz_offset, 10);
  const tzOffsetMinutes = Number.isFinite(tzOffset) ? tzOffset : 0;

  const range = periodRange(period, tzOffsetMinutes);
  const prev = previousRange(range);
  const inputs = await loadProgressInputs(req.user.id);
  const current = buildPeriodSummary(inputs, range, tzOffsetMinutes);
  const previous = buildPeriodSummary(inputs, prev, tzOffsetMinutes);

  const has_enough_data = current.ai_input.checkin_count >= 3;
  const ai_insights_enabled = await consentEnabled(req.user.id, 'ai_insights', true);

  return ok(res, {
    period,
    range: { from: range.from, to: range.to },
    has_enough_data,
    ai_insights_enabled,
    average_mood: current.average_mood,
    best_day: current.best_day,
    difficult_day: current.difficult_day,
    plan_completion: current.plan_completion,
    most_used_exercise: current.most_used_exercise,
    frequent_trigger: current.frequent_trigger,
    ai_input: {
      mood_by_day: current.ai_input.mood_by_day,
      mood_variance: current.ai_input.mood_variance,
      mood_variance_prev_period: previous.ai_input.mood_variance,
      avg_score_prev_period: previous.ai_input.avg_score,
      plan_completion_prev_percent: previous.ai_input.plan_percent,
      exercise_counts: current.ai_input.exercise_counts,
      trigger_counts: current.ai_input.trigger_counts,
      symptom_counts: current.ai_input.symptom_counts,
      journal_entries: current.ai_input.journal_entries,
      checkin_days: current.ai_input.checkin_days,
    },
  });
});

const getInsight = asyncHandler(async (req, res) => {
  const period = String(req.query.period || 'weekly').toLowerCase();
  if (period !== 'weekly' && period !== 'monthly') {
    return fail(res, 'period must be weekly or monthly', 422);
  }
  const tzOffset = Number.parseInt(req.query.tz_offset, 10);
  const tzOffsetMinutes = Number.isFinite(tzOffset) ? tzOffset : 0;
  const range = periodRange(period, tzOffsetMinutes);

  const [row] = await query(
    `SELECT period, period_start, summary, direction, stability, created_at
     FROM progress_insights
     WHERE user_id = :uid AND period = :period AND period_start = :start
     LIMIT 1`,
    { uid: req.user.id, period, start: range.from }
  ).catch((err) => {
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  });

  if (!row) return ok(res, { insight: null });
  return ok(res, {
    insight: {
      period: row.period,
      period_start: parseDateOnly(row.period_start),
      summary: row.summary,
      direction: row.direction,
      stability: row.stability,
      created_at: row.created_at,
    },
  });
});

const putInsight = asyncHandler(async (req, res) => {
  const p = req.body;
  const periodStart = parseDateOnly(p.period_start);
  if (!periodStart) return fail(res, 'period_start must be a YYYY-MM-DD date', 422);

  await query(
    `INSERT INTO progress_insights
      (user_id, period, period_start, summary, direction, stability)
     VALUES (:uid, :period, :start, :summary, :direction, :stability)
     ON DUPLICATE KEY UPDATE
       summary = VALUES(summary),
       direction = VALUES(direction),
       stability = VALUES(stability),
       created_at = CURRENT_TIMESTAMP`,
    {
      uid: req.user.id,
      period: p.period,
      start: periodStart,
      summary: p.summary,
      direction: p.direction,
      stability: p.stability,
    }
  );

  const [row] = await query(
    `SELECT period, period_start, summary, direction, stability, created_at
     FROM progress_insights
     WHERE user_id = :uid AND period = :period AND period_start = :start`,
    { uid: req.user.id, period: p.period, start: periodStart }
  );
  return ok(
    res,
    {
      insight: {
        period: row.period,
        period_start: parseDateOnly(row.period_start),
        summary: row.summary,
        direction: row.direction,
        stability: row.stability,
        created_at: row.created_at,
      },
    },
    'Insight saved'
  );
});

module.exports = {
  getSummary,
  getInsight,
  putInsight,
  insightSchema,
};
