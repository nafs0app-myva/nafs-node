const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = Joi.object({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().required(),
  reason: Joi.string().allow('', null),
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM vacation_blocks WHERE therapist_id = :uid ORDER BY start_date DESC`,
    { uid: req.user.id }
  );
  return ok(res, { vacations: rows });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  if (new Date(p.end_date) < new Date(p.start_date)) {
    return fail(res, 'end_date must be on/after start_date', 422);
  }
  const conflicts = await query(
    `SELECT COUNT(*) AS c FROM sessions
     WHERE therapist_id = :uid AND status = 'scheduled'
       AND DATE(starts_at) BETWEEN :start_date AND :end_date`,
    { uid: req.user.id, start_date: p.start_date, end_date: p.end_date }
  );
  const result = await query(
    `INSERT INTO vacation_blocks (therapist_id, start_date, end_date, reason, conflicts_count)
     VALUES (:uid, :start_date, :end_date, :reason, :conflicts)`,
    {
      uid: req.user.id,
      start_date: p.start_date,
      end_date: p.end_date,
      reason: p.reason || null,
      conflicts: conflicts[0].c,
    }
  );
  const rows = await query(`SELECT * FROM vacation_blocks WHERE id = :id`, { id: result.insertId });
  return ok(res, { vacation: rows[0] }, 'Time off saved', 201);
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(`DELETE FROM vacation_blocks WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  if (!result.affectedRows) return fail(res, 'Vacation not found', 404);
  return ok(res, null, 'Deleted');
});

module.exports = { createSchema, list, create, remove };
