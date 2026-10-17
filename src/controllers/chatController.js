const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const startSchema = Joi.object({
  client_id: Joi.number().integer().required(),
  message: Joi.string().allow('', null),
});

const messageSchema = Joi.object({
  body: Joi.string().min(1).required(),
});

const listThreads = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT t.id, t.client_id, t.last_message_at, c.full_name AS client_name, c.avatar_url AS client_avatar,
            (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.is_read = 0 AND m.sender_user_id <> :uid) AS unread
     FROM chat_threads t
     JOIN therapist_clients c ON c.id = t.client_id
     WHERE t.therapist_id = :uid
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
    { uid: req.user.id }
  );
  return ok(res, { threads: rows });
});

const getMessages = asyncHandler(async (req, res) => {
  const threads = await query(
    `SELECT * FROM chat_threads WHERE id = :id AND therapist_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!threads.length) return fail(res, 'Chat not found', 404);
  const messages = await query(
    `SELECT id, sender_user_id, body, is_read, created_at
     FROM chat_messages WHERE thread_id = :id ORDER BY id ASC LIMIT 200`,
    { id: req.params.id }
  );
  await query(
    `UPDATE chat_messages SET is_read = 1
     WHERE thread_id = :id AND sender_user_id <> :uid AND is_read = 0`,
    { id: req.params.id, uid: req.user.id }
  );
  return ok(res, { thread: threads[0], messages });
});

const startThread = asyncHandler(async (req, res) => {
  const clients = await query(
    `SELECT id FROM therapist_clients WHERE id = :cid AND therapist_id = :uid`,
    { cid: req.body.client_id, uid: req.user.id }
  );
  if (!clients.length) return fail(res, 'Client not found', 404);

  let threads = await query(
    `SELECT * FROM chat_threads WHERE therapist_id = :uid AND client_id = :cid`,
    { uid: req.user.id, cid: req.body.client_id }
  );
  if (!threads.length) {
    const result = await query(
      `INSERT INTO chat_threads (therapist_id, client_id) VALUES (:uid, :cid)`,
      { uid: req.user.id, cid: req.body.client_id }
    );
    threads = await query(`SELECT * FROM chat_threads WHERE id = :id`, { id: result.insertId });
  }
  if (req.body.message) {
    await query(
      `INSERT INTO chat_messages (thread_id, sender_user_id, body) VALUES (:tid, :uid, :body)`,
      { tid: threads[0].id, uid: req.user.id, body: req.body.message }
    );
    await query(`UPDATE chat_threads SET last_message_at = NOW() WHERE id = :id`, {
      id: threads[0].id,
    });
  }
  return ok(res, { thread: threads[0] }, 'Chat ready', 201);
});

const sendMessage = asyncHandler(async (req, res) => {
  const threads = await query(
    `SELECT * FROM chat_threads WHERE id = :id AND therapist_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!threads.length) return fail(res, 'Chat not found', 404);
  const result = await query(
    `INSERT INTO chat_messages (thread_id, sender_user_id, body) VALUES (:tid, :uid, :body)`,
    { tid: req.params.id, uid: req.user.id, body: req.body.body }
  );
  await query(`UPDATE chat_threads SET last_message_at = NOW() WHERE id = :id`, {
    id: req.params.id,
  });
  const rows = await query(`SELECT * FROM chat_messages WHERE id = :id`, { id: result.insertId });
  return ok(res, { message: rows[0] }, 'Sent', 201);
});

module.exports = { startSchema, messageSchema, listThreads, getMessages, startThread, sendMessage };
