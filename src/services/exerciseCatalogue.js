const path = require('path');
const fsp = require('fs/promises');
const { query } = require('../config/db');
const env = require('../config/env');

const AUDIO_BASE =
  process.env.MEDIA_AUDIO_BASE_URL || 'https://www.soundhelix.com/examples/mp3';
const VIDEO_BASE =
  process.env.MEDIA_VIDEO_BASE_URL ||
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
const THUMB_BASE =
  process.env.MEDIA_THUMB_BASE_URL || `${env.app.url.replace(/\/$/, '')}/media/exercises`;

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'media', 'exercises', 'uploads');

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

/** Built-in seed catalogue (used when DB is empty / for first insert). */
const STATIC_EXERCISES = [
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
    sequence: [],
    action_label: 'Start Now',
    action_icon: 'arrow_forward',
    sort_order: 10,
    is_active: true,
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
    sequence: [],
    action_label: 'Start Now',
    action_icon: 'arrow_forward',
    sort_order: 20,
    is_active: true,
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
    sort_order: 30,
    is_active: true,
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
    sort_order: 40,
    is_active: true,
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
    sequence: [],
    action_label: 'Start Now',
    action_icon: 'arrow_forward',
    sort_order: 50,
    is_active: true,
  },
];

let cache = null; // { all: Exercise[], byId: Map }

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function rowToExercise(row) {
  const type = row.type === 'video' ? 'video' : 'audio';
  const audio_url = row.audio_url || null;
  const video_url = row.video_url || null;
  const media_url = row.media_url || (type === 'video' ? video_url : audio_url) || null;
  return {
    id: row.id,
    type,
    category: row.category || null,
    icon: row.icon || null,
    title: row.title,
    subtitle: row.subtitle || null,
    accent: row.accent || null,
    card_background: row.card_background || null,
    duration_minutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    difficulty: row.difficulty || null,
    tags: parseJson(row.tags, []),
    benefit_label: row.benefit_label || null,
    description: row.description || null,
    action_label: row.action_label || (type === 'video' ? 'Watch Now' : 'Start Now'),
    action_icon: row.action_icon || (type === 'video' ? 'play' : 'arrow_forward'),
    audio_url,
    video_url,
    media_url,
    media_mime: row.media_mime || (type === 'video' ? 'video/mp4' : 'audio/mpeg'),
    thumbnail_url: row.thumbnail_url || null,
    instructions: parseJson(row.instructions, []),
    sequence: parseJson(row.sequence, []),
    sort_order: Number(row.sort_order || 0),
    is_active: row.is_active == null ? true : !!row.is_active,
    updated_at: row.updated_at || null,
  };
}

function withDefaults(e) {
  return {
    action_label: e.type === 'video' ? 'Watch Now' : 'Start Now',
    action_icon: e.type === 'video' ? 'play' : 'arrow_forward',
    sequence: [],
    instructions: [],
    tags: [],
    is_active: true,
    ...e,
  };
}

function summary(e) {
  const full = withDefaults(e);
  const { instructions, sequence, ...rest } = full;
  return rest;
}

async function seedExercisesTable() {
  for (let i = 0; i < STATIC_EXERCISES.length; i += 1) {
    const e = STATIC_EXERCISES[i];
    await query(
      `INSERT INTO exercises
        (id, type, category, icon, title, subtitle, accent, card_background, duration_minutes,
         difficulty, tags, benefit_label, description, action_label, action_icon,
         audio_url, video_url, media_url, media_mime, thumbnail_url, instructions, sequence,
         sort_order, is_active)
       VALUES
        (:id, :type, :category, :icon, :title, :subtitle, :accent, :card_background, :duration_minutes,
         :difficulty, :tags, :benefit_label, :description, :action_label, :action_icon,
         :audio_url, :video_url, :media_url, :media_mime, :thumbnail_url, :instructions, :sequence,
         :sort_order, :is_active)
       ON DUPLICATE KEY UPDATE id = id`,
      {
        id: e.id,
        type: e.type,
        category: e.category || null,
        icon: e.icon || null,
        title: e.title,
        subtitle: e.subtitle || null,
        accent: e.accent || null,
        card_background: e.card_background || null,
        duration_minutes: e.duration_minutes ?? null,
        difficulty: e.difficulty || null,
        tags: JSON.stringify(e.tags || []),
        benefit_label: e.benefit_label || null,
        description: e.description || null,
        action_label: e.action_label || null,
        action_icon: e.action_icon || null,
        audio_url: e.audio_url || null,
        video_url: e.video_url || null,
        media_url: e.media_url || null,
        media_mime: e.media_mime || null,
        thumbnail_url: e.thumbnail_url || null,
        instructions: JSON.stringify(e.instructions || []),
        sequence: JSON.stringify(e.sequence || []),
        sort_order: e.sort_order ?? (i + 1) * 10,
        is_active: e.is_active === false ? 0 : 1,
      }
    );
  }
}

async function loadFromDb({ includeInactive = false } = {}) {
  let rows;
  try {
    rows = await query(
      `SELECT * FROM exercises
       ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY sort_order ASC, id ASC`
    );
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
  return rows.map(rowToExercise);
}

async function refreshCache() {
  const rows = await loadFromDb({ includeInactive: true });
  const list = rows && rows.length ? rows : STATIC_EXERCISES.map(withDefaults);
  cache = {
    all: list,
    byId: new Map(list.map((e) => [e.id, e])),
  };
  return cache;
}

function invalidateCatalogue() {
  cache = null;
}

async function getCache() {
  if (!cache) await refreshCache();
  return cache;
}

async function listExercises({ includeInactive = false } = {}) {
  const c = await getCache();
  return includeInactive ? c.all : c.all.filter((e) => e.is_active !== false);
}

async function findExercise(id) {
  if (!id) return null;
  const c = await getCache();
  return c.byId.get(String(id)) || null;
}

async function getExerciseIds() {
  const list = await listExercises({ includeInactive: false });
  return list.map((e) => e.id);
}

async function updateExercise(id, patch) {
  const existing = await findExercise(id);
  if (!existing) {
    const err = new Error('Exercise not found');
    err.status = 404;
    throw err;
  }

  const fields = [];
  const params = { id };
  const map = {
    title: 'title',
    subtitle: 'subtitle',
    description: 'description',
    category: 'category',
    type: 'type',
    duration_minutes: 'duration_minutes',
    difficulty: 'difficulty',
    benefit_label: 'benefit_label',
    accent: 'accent',
    card_background: 'card_background',
    icon: 'icon',
    action_label: 'action_label',
    action_icon: 'action_icon',
    sort_order: 'sort_order',
    is_active: 'is_active',
  };

  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    fields.push(`${col} = :${key}`);
    if (key === 'is_active') params[key] = patch[key] ? 1 : 0;
    else params[key] = patch[key];
  }
  if (patch.tags !== undefined) {
    fields.push('tags = :tags');
    params.tags = JSON.stringify(Array.isArray(patch.tags) ? patch.tags : []);
  }
  if (!fields.length) return existing;

  await query(`UPDATE exercises SET ${fields.join(', ')} WHERE id = :id`, params);
  invalidateCatalogue();
  return findExercise(id);
}

async function ensureUploadDir(exerciseId) {
  const dir = path.join(UPLOAD_ROOT, String(exerciseId));
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function publicUploadUrl(exerciseId, filename) {
  const base = env.app.url.replace(/\/$/, '');
  return `${base}/media/exercises/uploads/${encodeURIComponent(exerciseId)}/${encodeURIComponent(filename)}`;
}

/**
 * Persist an uploaded media file for an exercise and update URL columns.
 * @param {'video'|'audio'|'thumbnail'} kind
 */
async function saveExerciseMedia(exerciseId, kind, file) {
  const existing = await findExercise(exerciseId);
  if (!existing) {
    const err = new Error('Exercise not found');
    err.status = 404;
    throw err;
  }
  if (!file?.path) {
    const err = new Error('No file uploaded');
    err.status = 422;
    throw err;
  }

  const dir = await ensureUploadDir(exerciseId);
  const ext = path.extname(file.originalname || '') || (kind === 'thumbnail' ? '.jpg' : kind === 'audio' ? '.mp3' : '.mp4');
  const filename = `${kind}-${Date.now()}${ext.toLowerCase()}`;
  const dest = path.join(dir, filename);
  await fsp.rename(file.path, dest).catch(async () => {
    await fsp.copyFile(file.path, dest);
    await fsp.unlink(file.path).catch(() => {});
  });

  const url = publicUploadUrl(exerciseId, filename);
  const mime = (file.mimetype || '').slice(0, 80) || null;

  if (kind === 'video') {
    await query(
      `UPDATE exercises
       SET video_url = :url, media_url = :url, media_mime = COALESCE(:mime, 'video/mp4'), type = 'video'
       WHERE id = :id`,
      { id: exerciseId, url, mime }
    );
  } else if (kind === 'audio') {
    await query(
      `UPDATE exercises
       SET audio_url = :url, media_url = :url, media_mime = COALESCE(:mime, 'audio/mpeg'), type = 'audio'
       WHERE id = :id`,
      { id: exerciseId, url, mime }
    );
  } else if (kind === 'thumbnail') {
    await query(`UPDATE exercises SET thumbnail_url = :url WHERE id = :id`, {
      id: exerciseId,
      url,
    });
  } else {
    const err = new Error('kind must be video, audio or thumbnail');
    err.status = 422;
    throw err;
  }

  invalidateCatalogue();
  return findExercise(exerciseId);
}

function slugifyId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

async function createExercise(payload) {
  let id = slugifyId(payload.id);
  if (!id) id = slugifyId(payload.title);
  if (!id) {
    const err = new Error('Could not build id from title (need letters or numbers)');
    err.status = 422;
    throw err;
  }
  const existing = await findExercise(id);
  if (existing) {
    const err = new Error('Exercise id already exists');
    err.status = 409;
    throw err;
  }
  const type = payload.type === 'video' ? 'video' : 'audio';
  await query(
    `INSERT INTO exercises
      (id, type, category, icon, title, subtitle, accent, card_background, duration_minutes,
       difficulty, tags, benefit_label, description, action_label, action_icon,
       sort_order, is_active, instructions, sequence)
     VALUES
      (:id, :type, :category, :icon, :title, :subtitle, :accent, :card_background, :duration_minutes,
       :difficulty, :tags, :benefit_label, :description, :action_label, :action_icon,
       :sort_order, 1, '[]', '[]')`,
    {
      id,
      type,
      category: payload.category || null,
      icon: payload.icon || (type === 'video' ? 'video' : 'air'),
      title: payload.title,
      subtitle: payload.subtitle || null,
      accent: payload.accent || '#1E9D5C',
      card_background: payload.card_background || '#DCF3E6',
      duration_minutes: payload.duration_minutes ?? null,
      difficulty: payload.difficulty || 'beginner',
      tags: JSON.stringify(payload.tags || []),
      benefit_label: payload.benefit_label || null,
      description: payload.description || null,
      action_label: payload.action_label || (type === 'video' ? 'Watch Now' : 'Start Now'),
      action_icon: payload.action_icon || (type === 'video' ? 'play' : 'arrow_forward'),
      sort_order: payload.sort_order ?? 100,
    }
  );
  invalidateCatalogue();
  return findExercise(id);
}

module.exports = {
  STATIC_EXERCISES,
  UPLOAD_ROOT,
  withDefaults,
  summary,
  seedExercisesTable,
  listExercises,
  findExercise,
  getExerciseIds,
  updateExercise,
  saveExerciseMedia,
  createExercise,
  invalidateCatalogue,
  refreshCache,
};
