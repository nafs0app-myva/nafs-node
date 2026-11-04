const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

/**
 * Static exercise catalogue (same for every user). Kept in code rather than a
 * table — it is small, read-only and has no per-user state. Colours are hex
 * strings and icons are short keys the app maps to its own icon set.
 *
 * Media: every audio exercise exposes `audio_url` + `media_url`; every video
 * exercise exposes `video_url` + `media_url`. Override the CDN base with
 * MEDIA_BASE_URL (defaults to public sample hosts so players work out of the box).
 *
 * Completion is per-user / per-day in `exercise_completions` so My Plan and
 * GET /home/dashboard → today_exercises can share real `done` flags.
 *
 *  GET /exercises                      → { exercises: [summary...] }
 *  GET /exercises/:id                  → { exercise: full }
 *  GET /plan/exercises                 → { date, exercises[+done], progress }
 *  POST /plan/exercises/:id/complete   → mark done for today
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

async function completedExerciseIdsToday(userId) {
  try {
    const rows = await query(
      `SELECT exercise_id
       FROM exercise_completions
       WHERE user_id = :uid AND completed_on = CURDATE()`,
      { uid: userId }
    );
    return new Set(rows.map((r) => String(r.exercise_id)));
  } catch (err) {
    // Table may not exist yet on a host that has not run ensureSchema.
    if (err.code === 'ER_NO_SUCH_TABLE') return new Set();
    throw err;
  }
}

/**
 * Today's My Plan exercises — same summary shape as GET /exercises, plus `done`.
 * Used by GET /plan/exercises and GET /home/dashboard → today_exercises.
 */
async function buildTodayExercises(userId, { tag } = {}) {
  const filter = (tag || '').trim().toLowerCase();
  const rows = EXERCISES.filter((e) => !filter || e.tags.some((t) => t.toLowerCase() === filter)).map(
    summary
  );
  const doneIds = await completedExerciseIdsToday(userId);
  return rows.map((e) => ({ ...e, done: doneIds.has(String(e.id)) }));
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

const list = asyncHandler(async (req, res) => {
  const tag = (req.query.tag || '').trim().toLowerCase();
  const rows = EXERCISES.filter((e) => !tag || e.tags.some((t) => t.toLowerCase() === tag));
  return ok(res, { exercises: rows.map(summary) });
});

const getOne = asyncHandler(async (req, res) => {
  const found = EXERCISES.find((e) => e.id === req.params.id);
  if (!found) return fail(res, 'Exercise not found', 404);
  const doneIds = await completedExerciseIdsToday(req.user.id);
  return ok(res, {
    exercise: { ...withDefaults(found), done: doneIds.has(String(found.id)) },
  });
});

/**
 * GET /plan/exercises — Figma "My Plan" today's schedule.
 */
const planExercises = asyncHandler(async (req, res) => {
  const exercises = await buildTodayExercises(req.user.id, { tag: req.query.tag });
  const today = new Date().toISOString().slice(0, 10);
  const progress = planProgress(exercises);
  return ok(res, {
    date: today,
    headline: 'Daily Rhythm',
    subheadline: 'Take care of yourself today',
    focus_goal_minutes: 30,
    exercises,
    progress,
  });
});

/**
 * POST /plan/exercises/:id/complete — mark an exercise done for today.
 */
const completeExercise = asyncHandler(async (req, res) => {
  const found = EXERCISES.find((e) => e.id === req.params.id);
  if (!found) return fail(res, 'Exercise not found', 404);

  await query(
    `INSERT INTO exercise_completions (user_id, exercise_id, completed_on)
     VALUES (:uid, :exercise_id, CURDATE())
     ON DUPLICATE KEY UPDATE completed_on = VALUES(completed_on)`,
    { uid: req.user.id, exercise_id: found.id }
  );

  const exercises = await buildTodayExercises(req.user.id);
  return ok(
    res,
    {
      exercise_id: found.id,
      done: true,
      today_exercises: exercises,
      progress: planProgress(exercises),
    },
    'Exercise marked complete for today'
  );
});

module.exports = {
  list,
  getOne,
  planExercises,
  completeExercise,
  buildTodayExercises,
  planProgress,
};
