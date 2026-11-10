const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

/**
 * Static exercise catalogue (same for every user). Kept in code rather than a
 * table — it is small, read-only and has no per-user state.
 *
 * Per-user "My Plan" lives in `user_exercise_plan` (exercise_id references
 * catalogue string ids). Catalogue routes stay read-only; plan is mutable.
 *
 *  GET    /exercises                         → library list
 *  GET    /exercises/:id                     → one exercise (+ on_plan / done)
 *  GET    /plan/exercises                    → this user's plan items
 *  POST   /plan/exercises                    → add { exercise_id } (idempotent)
 *  DELETE /plan/exercises/:exercise_id       → remove from plan
 *  POST   /plan/exercises/:exercise_id/complete → set completed_at (today done)
 */

const AUDIO_BASE =
  process.env.MEDIA_AUDIO_BASE_URL ||
  'https://www.soundhelix.com/examples/mp3';
const VIDEO_BASE =
  process.env.MEDIA_VIDEO_BASE_URL ||
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
const THUMB_BASE =
  process.env.MEDIA_THUMB_BASE_URL || `${env.app.url.replace(/\/$/, '')}/media/exercises`;

function audioMedia(file, thumb) {
  const audio_url = `${AUDIO_BASE}/${file}`;
  return {
    audio_url,
    video_url: null,
    media_url: audio_url,
    media_mime: 'audio/mpeg',
    thumbnail_url: `${THUMB_BASE}/${thumb}`,
  };
}

function videoMedia(file, thumb) {
  const video_url = `${VIDEO_BASE}/${file}`;
  return {
    audio_url: null,
    video_url,
    media_url: video_url,
    media_mime: 'video/mp4',
    thumbnail_url: `${THUMB_BASE}/${thumb}`,
  };
}

const EXERCISES = [
  {
    id: 'understand_yourself',
    type: 'audio',
    category: 'Mindset',
    icon: 'location',
    title: 'Understand Yourself',
    subtitle: 'Try to understand yourself more deeply',
    accent: '#E2654A',
    card_background: '#FCE4DE',
    duration_minutes: 5,
    difficulty: 'beginner',
    tags: ['Anxiety'],
    benefit_label: 'Self Awareness',
    description:
      'A short guided reflection that helps you check in with your own thoughts and feelings, ' +
      'building the self-awareness that underlies most other mental wellness practices.',
    ...audioMedia('SoundHelix-Song-1.mp3', 'understand_yourself.jpg'),
    instructions: [
      { title: 'Pause', body: 'Find a quiet moment and sit comfortably.' },
      { title: 'Reflect', body: 'Ask yourself how you are really feeling right now, without judgment.' },
      { title: 'Name It', body: 'Put a word or two to what comes up — just naming it helps.' },
    ],
  },
  {
    id: 'box_breathing',
    type: 'audio',
    category: 'Breathwork',
    icon: 'air',
    title: 'Box Breathing',
    subtitle: '4-4-4-4 rhythm to center your nervous system',
    accent: '#1E9D5C',
    card_background: '#DCF3E6',
    duration_minutes: 3,
    difficulty: 'beginner',
    tags: ['Anxiety', 'Stress'],
    benefit_label: 'Anxiety Relief',
    description:
      'A powerful, yet simple, relaxation technique that aims to return breathing to its normal ' +
      'rhythm. It helps clear the mind, relax the body, and improve focus.',
    ...audioMedia('SoundHelix-Song-2.mp3', 'box_breathing.jpg'),
    instructions: [
      {
        title: 'Breathe In',
        body: 'Slowly inhale through your nose while counting to four in your head. Feel the air fill your lungs.',
      },
      { title: 'Hold', body: 'Hold your breath for a count of four. Try not to clamp your mouth or nose shut.' },
      { title: 'Breathe Out', body: 'Slowly exhale through your mouth for a count of four. Gently push the air out.' },
      { title: 'Hold', body: 'Hold your breath for a count of four before beginning the cycle again.' },
    ],
  },
  {
    id: 'mindful_reset_video',
    type: 'video',
    category: 'Grounding',
    icon: 'video',
    title: 'Mindful Reset Video',
    subtitle: 'Gentle visual grounding exercise',
    accent: '#5D4FD6',
    card_background: '#E5E3F9',
    duration_minutes: 7,
    difficulty: 'beginner',
    tags: ['Stress'],
    benefit_label: 'Grounding',
    description:
      'A short guided video that walks your senses back to the present moment — useful whenever ' +
      'your thoughts are racing or you feel disconnected from your surroundings.',
    action_label: 'Watch Now',
    action_icon: 'play',
    ...videoMedia('ForBiggerBlazes.mp4', 'mindful_reset_video.jpg'),
    instructions: [
      { title: 'Settle In', body: 'Find a comfortable spot and press play.' },
      { title: 'Follow Along', body: 'Let the video guide your attention through sight, sound and touch.' },
      { title: 'Notice', body: 'Notice how your body feels once the video ends.' },
    ],
    sequence: [
      { title: 'Mountain Pose Grounding', tag: 'Centering', duration_label: '0:15', start_seconds: 0, icon: 'self_improvement', accent: '#5D4FD6' },
      { title: 'Gentle Side Reach', tag: 'Lateral Release', duration_label: '0:20', start_seconds: 15, icon: 'accessibility_new', accent: '#5B9BE8' },
      { title: 'Standing Rotations (Left)', tag: 'Spine Release', duration_label: '0:20', start_seconds: 35, icon: 'person', accent: '#5D4FD6' },
      { title: 'Standing Rotations (Right)', tag: 'Bilateral Alignment', duration_label: '0:20', start_seconds: 55, icon: 'compare_arrows', accent: '#5B9BE8' },
      { title: 'Ribcage Lateral Expansion', tag: 'Intercostal Breath', duration_label: '0:30', start_seconds: 75, icon: 'height', accent: '#5D4FD6' },
      { title: 'Gentle Torso Unwinding', tag: 'Somatic Reset', duration_label: '0:25', start_seconds: 105, icon: 'accessibility_new', accent: '#1E9D5C' },
      { title: 'Grounded Stillness & Integration', tag: 'Vagal Recovery', duration_label: '0:30', start_seconds: 130, icon: 'spa', accent: '#2F63E0' },
      { title: 'Closing Breath & Release', tag: 'Integration', duration_label: '0:20', start_seconds: 160, icon: 'air', accent: '#1E9D5C' },
    ],
  },
  {
    id: 'midday_desk_mobility',
    type: 'video',
    category: 'Mobility',
    icon: 'fitness',
    title: 'Midday Desk Mobility',
    subtitle: 'Release neck and shoulder tension',
    accent: '#E2932A',
    card_background: '#FCEFCE',
    duration_minutes: 5,
    difficulty: 'beginner',
    tags: ['Stress'],
    benefit_label: 'Tension Relief',
    description:
      'A quick set of seated stretches to release the neck and shoulder tension that builds up ' +
      'during long stretches at a desk.',
    action_label: 'Watch Now',
    action_icon: 'play',
    ...videoMedia('ForBiggerEscapes.mp4', 'midday_desk_mobility.jpg'),
    instructions: [
      { title: 'Roll', body: 'Slowly roll your shoulders back five times.' },
      { title: 'Tilt', body: 'Gently tilt your head toward each shoulder, holding for a few seconds.' },
      { title: 'Reach', body: 'Reach both arms overhead and stretch upward.' },
    ],
    sequence: [
      { title: 'Shoulder Rolls', tag: 'Warm-Up', duration_label: '0:20', start_seconds: 0, icon: 'autorenew', accent: '#E2932A' },
      { title: 'Neck Tilts (Left)', tag: 'Lateral Release', duration_label: '0:20', start_seconds: 20, icon: 'accessibility_new', accent: '#E2932A' },
      { title: 'Neck Tilts (Right)', tag: 'Lateral Release', duration_label: '0:20', start_seconds: 40, icon: 'accessibility_new', accent: '#E2932A' },
      { title: 'Overhead Reach', tag: 'Upper-Body Stretch', duration_label: '0:25', start_seconds: 60, icon: 'height', accent: '#E2932A' },
    ],
  },
  {
    id: 'evening_wind_down',
    type: 'audio',
    category: 'Rest',
    icon: 'night',
    title: 'Evening Wind Down',
    subtitle: 'Prepare your mind for deep, restful sleep',
    accent: '#2F63E0',
    card_background: '#E0ECFB',
    duration_minutes: 10,
    difficulty: 'beginner',
    tags: ['Stress', 'Anxiety'],
    benefit_label: 'Better Sleep',
    description:
      'A calming wind-down routine that eases your mind and body out of the day and toward deep, ' +
      'restful sleep.',
    ...audioMedia('SoundHelix-Song-3.mp3', 'evening_wind_down.jpg'),
    instructions: [
      { title: 'Dim the Lights', body: 'Lower the lights and put screens away.' },
      { title: 'Breathe Slowly', body: 'Take slow, deep breaths, letting each exhale last longer than the inhale.' },
      { title: 'Rest', body: 'Let your body settle and your mind grow quiet.' },
    ],
  },
];

const EXERCISE_IDS = EXERCISES.map((e) => e.id);

function findExercise(id) {
  return EXERCISES.find((e) => e.id === id) || null;
}

function withDefaults(e) {
  const media =
    e.type === 'video'
      ? {
          audio_url: e.audio_url || null,
          video_url: e.video_url || null,
          media_url: e.media_url || e.video_url || null,
          media_mime: e.media_mime || 'video/mp4',
          thumbnail_url: e.thumbnail_url || null,
        }
      : {
          audio_url: e.audio_url || null,
          video_url: e.video_url || null,
          media_url: e.media_url || e.audio_url || null,
          media_mime: e.media_mime || 'audio/mpeg',
          thumbnail_url: e.thumbnail_url || null,
        };
  return {
    action_label: 'Start Now',
    action_icon: 'arrow_forward',
    sequence: [],
    ...e,
    ...media,
  };
}

function summary(e) {
  const { instructions, sequence, ...rest } = withDefaults(e);
  return rest;
}

function isCompletedToday(completedAt) {
  if (!completedAt) return false;
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  return (
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate()
  );
}

function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
}

function planItemFromRow(row) {
  const catalog = findExercise(row.exercise_id);
  if (!catalog) return null;
  const done = isCompletedToday(row.completed_at);
  return {
    ...summary(catalog),
    plan_id: row.id,
    exercise_id: row.exercise_id,
    added_at: row.added_at,
    scheduled_for: toDateOnly(row.scheduled_for),
    completed_at: row.completed_at || null,
    done,
  };
}

/**
 * User's My Plan items joined to catalogue summaries.
 * @param {number} userId
 * @param {{ todayOnly?: boolean }} [opts] todayOnly → scheduled_for is null or today
 */
async function buildUserPlanExercises(userId, { todayOnly = false } = {}) {
  let sql = `
    SELECT id, exercise_id, scheduled_for, completed_at, added_at
    FROM user_exercise_plan
    WHERE user_id = :uid`;
  if (todayOnly) {
    sql += ` AND (scheduled_for IS NULL OR scheduled_for = CURDATE())`;
  }
  sql += ` ORDER BY added_at ASC, id ASC`;

  let rows;
  try {
    rows = await query(sql, { uid: userId });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }

  return rows.map(planItemFromRow).filter(Boolean);
}

function planProgress(exercises) {
  const total = exercises.length;
  const done = exercises.filter((e) => e.done).length;
  return {
    done,
    total,
    label: `${done}/${total}`,
    tasks_done_label: 'Tasks Done',
  };
}

async function planRowForUser(userId, exerciseId) {
  const [row] = await query(
    `SELECT id, exercise_id, scheduled_for, completed_at, added_at
     FROM user_exercise_plan
     WHERE user_id = :uid AND exercise_id = :exercise_id
     LIMIT 1`,
    { uid: userId, exercise_id: exerciseId }
  );
  return row || null;
}

const addToPlanSchema = Joi.object({
  exercise_id: Joi.string()
    .valid(...EXERCISE_IDS)
    .required(),
  scheduled_for: Joi.date().iso().allow(null).optional(),
});

const list = asyncHandler(async (req, res) => {
  const tag = (req.query.tag || '').trim().toLowerCase();
  const rows = EXERCISES.filter((e) => !tag || e.tags.some((t) => t.toLowerCase() === tag));
  return ok(res, { exercises: rows.map(summary) });
});

const getOne = asyncHandler(async (req, res) => {
  const found = findExercise(req.params.id);
  if (!found) return fail(res, 'Exercise not found', 404);

  let onPlan = false;
  let done = false;
  let planMeta = null;
  try {
    const row = await planRowForUser(req.user.id, found.id);
    if (row) {
      onPlan = true;
      done = isCompletedToday(row.completed_at);
      planMeta = {
        plan_id: row.id,
        added_at: row.added_at,
        scheduled_for: toDateOnly(row.scheduled_for),
        completed_at: row.completed_at || null,
      };
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }

  return ok(res, {
    exercise: {
      ...withDefaults(found),
      on_plan: onPlan,
      done,
      plan: planMeta,
    },
  });
});

/**
 * GET /plan/exercises — this user's saved plan (not the full catalogue).
 */
const listPlan = asyncHandler(async (req, res) => {
  const todayOnly = String(req.query.today || '').toLowerCase() === 'true';
  const exercises = await buildUserPlanExercises(req.user.id, { todayOnly });
  const today = new Date().toISOString().slice(0, 10);
  return ok(res, {
    date: today,
    headline: 'Daily Rhythm',
    subheadline: 'Take care of yourself today',
    focus_goal_minutes: 30,
    exercises,
    progress: planProgress(exercises),
  });
});

/**
 * POST /plan/exercises — add one catalogue exercise to the user's plan (idempotent).
 */
const addToPlan = asyncHandler(async (req, res) => {
  const exerciseId = req.body.exercise_id;
  const catalog = findExercise(exerciseId);
  if (!catalog) return fail(res, 'Exercise not found in catalogue', 404);

  const scheduledFor =
    req.body.scheduled_for != null
      ? String(req.body.scheduled_for).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const before = await planRowForUser(req.user.id, exerciseId);

  await query(
    `INSERT INTO user_exercise_plan (user_id, exercise_id, scheduled_for)
     VALUES (:uid, :exercise_id, :scheduled_for)
     ON DUPLICATE KEY UPDATE exercise_id = VALUES(exercise_id)`,
    { uid: req.user.id, exercise_id: exerciseId, scheduled_for: scheduledFor }
  );

  const row = await planRowForUser(req.user.id, exerciseId);
  if (before) {
    return ok(res, { exercise: planItemFromRow(row), created: false }, 'Already on plan');
  }
  return ok(res, { exercise: planItemFromRow(row), created: true }, 'Added to My Plan', 201);
});

/**
 * DELETE /plan/exercises/:exercise_id
 */
const removeFromPlan = asyncHandler(async (req, res) => {
  const exerciseId = req.params.exercise_id || req.params.id;
  if (!findExercise(exerciseId)) return fail(res, 'Exercise not found in catalogue', 404);

  const result = await query(
    `DELETE FROM user_exercise_plan WHERE user_id = :uid AND exercise_id = :exercise_id`,
    { uid: req.user.id, exercise_id: exerciseId }
  );
  if (!result.affectedRows) return fail(res, 'Exercise is not on your plan', 404);
  return ok(res, { exercise_id: exerciseId }, 'Removed from My Plan');
});

/**
 * POST /plan/exercises/:exercise_id/complete — mark plan item completed today.
 */
const completePlanExercise = asyncHandler(async (req, res) => {
  const exerciseId = req.params.exercise_id || req.params.id;
  if (!findExercise(exerciseId)) return fail(res, 'Exercise not found in catalogue', 404);

  const existing = await planRowForUser(req.user.id, exerciseId);
  if (!existing) return fail(res, 'Exercise is not on your plan — add it first', 404);

  await query(
    `UPDATE user_exercise_plan
     SET completed_at = NOW()
     WHERE user_id = :uid AND exercise_id = :exercise_id`,
    { uid: req.user.id, exercise_id: exerciseId }
  );

  // Append-only completion log (Progress tab weekly/monthly stats).
  try {
    await query(
      `INSERT INTO exercise_completions (user_id, exercise_id, completed_at)
       VALUES (:uid, :exercise_id, NOW())`,
      { uid: req.user.id, exercise_id: exerciseId }
    );
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }

  const row = await planRowForUser(req.user.id, exerciseId);
  const exercises = await buildUserPlanExercises(req.user.id, { todayOnly: true });
  return ok(
    res,
    {
      exercise: planItemFromRow(row),
      today_exercises: exercises,
      progress: planProgress(exercises),
    },
    'Exercise marked complete for today'
  );
});

module.exports = {
  list,
  getOne,
  listPlan,
  addToPlan,
  removeFromPlan,
  completePlanExercise,
  addToPlanSchema,
  buildUserPlanExercises,
  planProgress,
  findExercise,
  EXERCISE_IDS,
};
