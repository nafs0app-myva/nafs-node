const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = Joi.object({
  full_name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().allow('', null),
  phone: Joi.string().allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  notes: Joi.string().allow('', null),
});

const updateSchema = createSchema.fork(['full_name'], (s) => s.optional()).min(1);

const list = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT id, full_name, email, phone, avatar_url, status, last_session_at, created_at
             FROM therapist_clients WHERE therapist_id = :uid`;
  const params = { uid: req.user.id };
  if (q) {
    sql += ` AND (full_name LIKE :q OR email LIKE :q OR phone LIKE :q)`;
    params.q = `%${q}%`;
  }
  sql += ` ORDER BY full_name ASC`;
  const rows = await query(sql, params);
  return ok(res, { clients: rows });
});

const getOne = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM therapist_clients WHERE id = :id AND therapist_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!rows.length) return fail(res, 'Client not found', 404);
  const sessions = await query(
    `SELECT id, title, session_type, status, starts_at, ends_at, fee_amount
     FROM sessions WHERE client_id = :id AND therapist_id = :uid
     ORDER BY starts_at DESC LIMIT 20`,
    { id: req.params.id, uid: req.user.id }
  );
  return ok(res, { client: rows[0], sessions });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO therapist_clients (therapist_id, full_name, email, phone, avatar_url, notes)
     VALUES (:uid, :full_name, :email, :phone, :avatar_url, :notes)`,
    {
      uid: req.user.id,
      full_name: p.full_name,
      email: p.email || null,
      phone: p.phone || null,
      avatar_url: p.avatar_url || null,
      notes: p.notes || null,
    }
  );
  const rows = await query(`SELECT * FROM therapist_clients WHERE id = :id`, { id: result.insertId });
  return ok(res, { client: rows[0] }, 'Client created', 201);
});

const update = asyncHandler(async (req, res) => {
  const existing = await query(
    `SELECT id FROM therapist_clients WHERE id = :id AND therapist_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!existing.length) return fail(res, 'Client not found', 404);
  const p = req.body;
  await query(
    `UPDATE therapist_clients
     SET full_name = COALESCE(:full_name, full_name),
         email = COALESCE(:email, email),
         phone = COALESCE(:phone, phone),
         avatar_url = COALESCE(:avatar_url, avatar_url),
         notes = COALESCE(:notes, notes)
     WHERE id = :id`,
    {
      id: req.params.id,
      full_name: p.full_name ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      avatar_url: p.avatar_url ?? null,
      notes: p.notes ?? null,
    }
  );
  const rows = await query(`SELECT * FROM therapist_clients WHERE id = :id`, { id: req.params.id });
  return ok(res, { client: rows[0] }, 'Client updated');
});

module.exports = { createSchema, updateSchema, list, getOne, create, update };
