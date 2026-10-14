const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, slug, title, description, duration_days, cover_image
     FROM challenges WHERE is_active = 1 ORDER BY id ASC`
  );
  return ok(res, { challenges: rows });
});

const detail = asyncHandler(async (req, res) => {
  const rows = await query(`SELECT * FROM challenges WHERE id = :id AND is_active = 1`, {
    id: req.params.id,
  });
  if (!rows.length) return fail(res, 'Challenge not found', 404);
  const tasks = await query(
    `SELECT id, day_number, title, description, task_type
     FROM challenge_tasks WHERE challenge_id = :id ORDER BY day_number, id`,
    { id: req.params.id }
  );
  return ok(res, { challenge: rows[0], tasks });
});

const join = asyncHandler(async (req, res) => {
  const challengeId = req.params.id;
  const challenges = await query(`SELECT id FROM challenges WHERE id = :id AND is_active = 1`, {
    id: challengeId,
  });
  if (!challenges.length) return fail(res, 'Challenge not found', 404);

  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = await query(
      `INSERT INTO user_challenges (user_id, challenge_id, started_on, current_day, status)
       VALUES (:user_id, :challenge_id, :started_on, 1, 'active')`,
      { user_id: req.user.id, challenge_id: challengeId, started_on: today }
    );
    const rows = await query(`SELECT * FROM user_challenges WHERE id = :id`, { id: result.insertId });
    return ok(res, { enrollment: rows[0] }, 'Joined challenge', 201);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 'Already enrolled in this challenge', 409);
    throw err;
  }
});

const myChallenges = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT uc.*, c.title, c.duration_days, c.slug
     FROM user_challenges uc
     JOIN challenges c ON c.id = uc.challenge_id
     WHERE uc.user_id = :user_id
     ORDER BY uc.id DESC`,
    { user_id: req.user.id }
  );
  return ok(res, { enrollments: rows });
});

const completeTask = asyncHandler(async (req, res) => {
  const enrollmentId = req.params.id;
  const taskId = req.params.taskId;
  const enrollments = await query(
    `SELECT * FROM user_challenges WHERE id = :id AND user_id = :user_id AND status = 'active'`,
    { id: enrollmentId, user_id: req.user.id }
  );
  if (!enrollments.length) return fail(res, 'Active enrollment not found', 404);

  const tasks = await query(
    `SELECT * FROM challenge_tasks WHERE id = :task_id AND challenge_id = :challenge_id`,
    { task_id: taskId, challenge_id: enrollments[0].challenge_id }
  );
  if (!tasks.length) return fail(res, 'Task not found for this challenge', 404);

  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT IGNORE INTO user_challenge_task_logs (user_challenge_id, challenge_task_id, completed_on)
     VALUES (:user_challenge_id, :challenge_task_id, :completed_on)`,
    {
      user_challenge_id: enrollmentId,
      challenge_task_id: taskId,
      completed_on: today,
    }
  );

  // Advance day when all tasks for current day are done
  const currentDay = enrollments[0].current_day;
  const dayTasks = await query(
    `SELECT id FROM challenge_tasks WHERE challenge_id = :cid AND day_number = :day`,
    { cid: enrollments[0].challenge_id, day: currentDay }
  );
  const done = await query(
    `SELECT challenge_task_id FROM user_challenge_task_logs WHERE user_challenge_id = :eid`,
    { eid: enrollmentId }
  );
  const doneSet = new Set(done.map((d) => d.challenge_task_id));
  const allDone = dayTasks.every((t) => doneSet.has(t.id));
  if (allDone) {
    const challenges = await query(`SELECT duration_days FROM challenges WHERE id = :id`, {
      id: enrollments[0].challenge_id,
    });
    const nextDay = currentDay + 1;
    if (nextDay > challenges[0].duration_days) {
      await query(
        `UPDATE user_challenges SET status = 'completed', completed_at = NOW(), current_day = :day WHERE id = :id`,
        { id: enrollmentId, day: currentDay }
      );
    } else {
      await query(`UPDATE user_challenges SET current_day = :day WHERE id = :id`, {
        id: enrollmentId,
        day: nextDay,
      });
    }
  }

  return ok(res, null, 'Task completed');
});

module.exports = { list, detail, join, myChallenges, completeTask };
