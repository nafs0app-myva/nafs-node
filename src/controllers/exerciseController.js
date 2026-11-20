const path = require('path');
const fs = require('fs');
const Joi = require('joi');
const multer = require('multer');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const catalogue = require('../services/exerciseCatalogue');

/**
 * Exercise library + My Plan.
 * Catalogue is DB-backed (seeded from built-in defaults); admins can upload media.
 *
 *  GET    /exercises
 *  GET    /exercises/:id
 *  GET    /plan/exercises
 *  POST   /plan/exercises
 *  DELETE /plan/exercises/:exercise_id
 *  POST   /plan/exercises/:exercise_id/complete
 *  Admin:
 *  GET/POST /admin/panel/exercises
 *  PATCH    /admin/panel/exercises/:id
 *  POST     /admin/panel/exercises/:id/media
 */

const { withDefaults, summary, findExercise, listExercises } = catalogue;

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

async function planItemFromRow(row) {
  const catalog = await findExercise(row.exercise_id);
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

  const out = [];
  for (const row of rows) {
    const item = await planItemFromRow(row);
    if (item) out.push(item);
  }
  return out;
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
  exercise_id: Joi.string().trim().min(1).max(64).required(),
  scheduled_for: Joi.date().iso().allow(null).optional(),
});

const updateExerciseSchema = Joi.object({
  title: Joi.string().trim().min(2).max(160),
  subtitle: Joi.string().trim().max(255).allow('', null),
  description: Joi.string().trim().max(4000).allow('', null),
  category: Joi.string().trim().max(80).allow('', null),
  type: Joi.string().valid('audio', 'video'),
  duration_minutes: Joi.number().integer().min(1).max(180).allow(null),
  difficulty: Joi.string().trim().max(40).allow('', null),
  benefit_label: Joi.string().trim().max(80).allow('', null),
  accent: Joi.string().trim().max(20).allow('', null),
  card_background: Joi.string().trim().max(20).allow('', null),
  icon: Joi.string().trim().max(40).allow('', null),
  action_label: Joi.string().trim().max(80).allow('', null),
  action_icon: Joi.string().trim().max(40).allow('', null),
  sort_order: Joi.number().integer().min(0).max(9999),
  is_active: Joi.boolean(),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20),
}).min(1);

const createExerciseSchema = Joi.object({
  id: Joi.string().trim().min(2).max(64).required(),
  title: Joi.string().trim().min(2).max(160).required(),
  type: Joi.string().valid('audio', 'video').default('video'),
  subtitle: Joi.string().trim().max(255).allow('', null),
  description: Joi.string().trim().max(4000).allow('', null),
  category: Joi.string().trim().max(80).allow('', null),
  duration_minutes: Joi.number().integer().min(1).max(180).allow(null),
  difficulty: Joi.string().trim().max(40).allow('', null),
  benefit_label: Joi.string().trim().max(80).allow('', null),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20),
  sort_order: Joi.number().integer().min(0).max(9999),
});

const list = asyncHandler(async (req, res) => {
  const tag = (req.query.tag || '').trim().toLowerCase();
  const rows = await listExercises({ includeInactive: false });
  const filtered = rows.filter((e) => !tag || (e.tags || []).some((t) => String(t).toLowerCase() === tag));
  return ok(res, { exercises: filtered.map(summary) });
});

const getOne = asyncHandler(async (req, res) => {
  const found = await findExercise(req.params.id);
  if (!found || found.is_active === false) return fail(res, 'Exercise not found', 404);

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

const addToPlan = asyncHandler(async (req, res) => {
  const exerciseId = req.body.exercise_id;
  const catalogItem = await findExercise(exerciseId);
  if (!catalogItem || catalogItem.is_active === false) {
    return fail(res, 'Exercise not found in catalogue', 404);
  }

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
    return ok(res, { exercise: await planItemFromRow(row), created: false }, 'Already on plan');
  }
  return ok(res, { exercise: await planItemFromRow(row), created: true }, 'Added to My Plan', 201);
});

const removeFromPlan = asyncHandler(async (req, res) => {
  const exerciseId = req.params.exercise_id || req.params.id;
  if (!(await findExercise(exerciseId))) return fail(res, 'Exercise not found in catalogue', 404);

  const result = await query(
    `DELETE FROM user_exercise_plan WHERE user_id = :uid AND exercise_id = :exercise_id`,
    { uid: req.user.id, exercise_id: exerciseId }
  );
  if (!result.affectedRows) return fail(res, 'Exercise is not on your plan', 404);
  return ok(res, { exercise_id: exerciseId }, 'Removed from My Plan');
});

const completePlanExercise = asyncHandler(async (req, res) => {
  const exerciseId = req.params.exercise_id || req.params.id;
  if (!(await findExercise(exerciseId))) return fail(res, 'Exercise not found in catalogue', 404);

  const existing = await planRowForUser(req.user.id, exerciseId);
  if (!existing) return fail(res, 'Exercise is not on your plan — add it first', 404);

  await query(
    `UPDATE user_exercise_plan
     SET completed_at = NOW()
     WHERE user_id = :uid AND exercise_id = :exercise_id`,
    { uid: req.user.id, exercise_id: exerciseId }
  );

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
      exercise: await planItemFromRow(row),
      today_exercises: exercises,
      progress: planProgress(exercises),
    },
    'Exercise marked complete for today'
  );
});

// —— Admin catalogue management ——

const adminListExercises = asyncHandler(async (_req, res) => {
  const exercises = await listExercises({ includeInactive: true });
  return ok(res, { exercises: exercises.map(withDefaults) });
});

const adminCreateExercise = asyncHandler(async (req, res) => {
  try {
    const exercise = await catalogue.createExercise(req.body);
    return ok(res, { exercise }, 'Exercise created', 201);
  } catch (err) {
    return fail(res, err.message || 'Could not create exercise', err.status || 400);
  }
});

const adminUpdateExercise = asyncHandler(async (req, res) => {
  try {
    const exercise = await catalogue.updateExercise(req.params.id, req.body);
    return ok(res, { exercise }, 'Exercise updated');
  } catch (err) {
    return fail(res, err.message || 'Could not update exercise', err.status || 400);
  }
});

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.promises.mkdir(catalogue.UPLOAD_ROOT, { recursive: true });
        cb(null, catalogue.UPLOAD_ROOT);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`;
      cb(null, `tmp-${safe}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

const adminUploadMedia = (req, res, next) =>
  mediaUpload.single('file')(req, res, async (err) => {
    const cleanup = async () => {
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    };
    if (err) {
      await cleanup();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(res, 'File exceeds 200 MB limit', 422);
      }
      return next(err);
    }
    try {
      const kind = String(req.body.kind || req.query.kind || '').toLowerCase();
      if (!['video', 'audio', 'thumbnail'].includes(kind)) {
        await cleanup();
        return fail(res, 'kind must be video, audio or thumbnail', 422);
      }
      if (!req.file) {
        await cleanup();
        return fail(res, 'Attach the media as the "file" field', 422);
      }
      if (kind === 'video' && !/^video\//.test(req.file.mimetype || '')) {
        await cleanup();
        return fail(res, 'File must be a video', 422);
      }
      if (kind === 'audio' && !/^audio\//.test(req.file.mimetype || '')) {
        await cleanup();
        return fail(res, 'File must be an audio file', 422);
      }
      if (kind === 'thumbnail' && !/^image\//.test(req.file.mimetype || '')) {
        await cleanup();
        return fail(res, 'Thumbnail must be an image', 422);
      }
      const limits = { video: 200 * 1024 * 1024, audio: 50 * 1024 * 1024, thumbnail: 5 * 1024 * 1024 };
      if (req.file.size > limits[kind]) {
        await cleanup();
        const mb = Math.round(limits[kind] / (1024 * 1024));
        return fail(res, `${kind} must be ${mb} MB or smaller`, 422);
      }

      const exercise = await catalogue.saveExerciseMedia(req.params.id, kind, req.file);
      return ok(res, { exercise, kind }, 'Media uploaded');
    } catch (e) {
      await cleanup();
      if (e.status) return fail(res, e.message, e.status);
      return next(e);
    }
  });

module.exports = {
  list,
  getOne,
  listPlan,
  addToPlan,
  removeFromPlan,
  completePlanExercise,
  addToPlanSchema,
  updateExerciseSchema,
  createExerciseSchema,
  buildUserPlanExercises,
  planProgress,
  findExercise,
  adminListExercises,
  adminCreateExercise,
  adminUpdateExercise,
  adminUploadMedia,
};
