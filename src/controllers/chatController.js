const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { sendPush } = require('../services/pushService');

/**
 * Chat works for both roles on the same endpoints:
 *  - therapist: threads are keyed by `client_id` (a `therapist_clients` row)
 *  - client:    threads are the ones whose `therapist_clients.client_user_id`
 *               is the signed-in user; they open one with `therapist_id`
 *               (only allowed for a therapist they have booked).
 * Every thread row is returned with `peer_name` / `peer_avatar` describing the
 * *other* participant, so the app doesn't need to care which role it is.
 */
const startSchema = Joi.object({
  client_id: Joi.number().integer(), // therapist opening a thread with a client
  therapist_id: Joi.number().integer(), // client opening a thread with a therapist
  message: Joi.string().allow('', null),
}).or('client_id', 'therapist_id');

const messageSchema = Joi.object({
  body: Joi.string().min(1).required(),
});

/**
 * Pushes a new chat message to the other participant. Push only (no inbox row,
 * email or SMS - a chat would flood them) and only if they have push switched on.
 * Never throws: a failed push must not fail the send.
 */
async function pushNewMessage(req, thread, body) {
  try {
    let recipientId = thread.therapist_id;
    if (!isClient(req)) {
      const [c] = await query(`SELECT client_user_id FROM therapist_clients WHERE id = :id`, { id: thread.client_id });
      recipientId = c?.client_user_id;
    }
    if (!recipientId) return;
    const [prefs] = await query(`SELECT push_channel FROM notification_preferences WHERE user_id = :uid`, { uid: recipientId });
    if (prefs && !prefs.push_channel) return;
    const [sender] = await query(`SELECT full_name FROM users WHERE id = :id`, { id: req.user.id });
    await sendPush(recipientId, {
      title: sender?.full_name || 'New message',
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      // What the app needs to open the right conversation from the tap: the
      // therapist reaches a thread by client row, the client by therapist user id.
      data: {
        type: 'chat_message',
        thread_id: thread.id,
        sender_name: sender?.full_name || '',
        ...(isClient(req) ? { client_id: thread.client_id } : { therapist_id: thread.therapist_id }),
      },
    });
  } catch (err) {
    console.error('chat push failed', err.message);
  }
}

const isClient = (req) => req.user.role === 'client';

/** The thread if the signed-in user participates in it, else undefined. */
async function findOwnThread(req, threadId) {
  const sql = isClient(req)
    ? `SELECT t.* FROM chat_threads t
       JOIN therapist_clients c ON c.id = t.client_id
       WHERE t.id = :id AND c.client_user_id = :uid`
    : `SELECT t.* FROM chat_threads t WHERE t.id = :id AND t.therapist_id = :uid`;
  const rows = await query(sql, { id: threadId, uid: req.user.id });
  return rows[0];
}

const listThreads = asyncHandler(async (req, res) => {
  const lastMessage = `(SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message`;
  const unread = `(SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.is_read = 0 AND m.sender_user_id <> :uid) AS unread`;
  const rows = isClient(req)
    ? await query(
        `SELECT t.id, t.client_id, t.therapist_id, t.last_message_at,
                u.full_name AS peer_name, u.avatar_url AS peer_avatar,
                u.full_name AS therapist_name, c.full_name AS client_name, c.avatar_url AS client_avatar,
                ${lastMessage}, ${unread}
         FROM chat_threads t
         JOIN therapist_clients c ON c.id = t.client_id
         JOIN users u ON u.id = t.therapist_id
         WHERE c.client_user_id = :uid
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
        { uid: req.user.id }
      )
    : await query(
        `SELECT t.id, t.client_id, t.therapist_id, t.last_message_at,
                c.full_name AS peer_name, c.avatar_url AS peer_avatar,
                c.full_name AS client_name, c.avatar_url AS client_avatar,
                ${lastMessage}, ${unread}
         FROM chat_threads t
         JOIN therapist_clients c ON c.id = t.client_id
         WHERE t.therapist_id = :uid
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
        { uid: req.user.id }
      );
  return ok(res, { threads: rows });
});

const getMessages = asyncHandler(async (req, res) => {
  const thread = await findOwnThread(req, req.params.id);
  if (!thread) return fail(res, 'Chat not found', 404);
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
  return ok(res, { thread, messages });
});

/** Resolves (therapistId, therapist_clients.id) for the caller, or an error string. */
async function resolveParticipants(req) {
  if (isClient(req)) {
    const therapistId = req.body.therapist_id;
    if (!therapistId) return { error: 'therapist_id is required', status: 422 };
    const therapists = await query(`SELECT id FROM users WHERE id = :id AND role = 'therapist'`, {
      id: therapistId,
    });
    if (!therapists.length) return { error: 'Specialist not found', status: 404 };
    const bookings = await query(
      `SELECT id FROM bookings WHERE client_user_id = :uid AND therapist_id = :tid LIMIT 1`,
      { uid: req.user.id, tid: therapistId }
    );
    if (!bookings.length) {
      return { error: 'Book a session with this specialist before chatting', status: 403 };
    }
    let clients = await query(
      `SELECT id FROM therapist_clients WHERE therapist_id = :tid AND client_user_id = :uid`,
      { tid: therapistId, uid: req.user.id }
    );
    if (!clients.length) {
      const [user] = await query(`SELECT full_name, email, phone, avatar_url FROM users WHERE id = :uid`, {
        uid: req.user.id,
      });
      const created = await query(
        `INSERT INTO therapist_clients (therapist_id, client_user_id, full_name, email, phone, avatar_url)
         VALUES (:tid, :uid, :full_name, :email, :phone, :avatar_url)`,
        {
          tid: therapistId,
          uid: req.user.id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          avatar_url: user.avatar_url,
        }
      );
      clients = [{ id: created.insertId }];
    }
    return { therapistId, clientRowId: clients[0].id };
  }

  const clientId = req.body.client_id;
  if (!clientId) return { error: 'client_id is required', status: 422 };
  const clients = await query(
    `SELECT id FROM therapist_clients WHERE id = :cid AND therapist_id = :uid`,
    { cid: clientId, uid: req.user.id }
  );
  if (!clients.length) return { error: 'Client not found', status: 404 };
  return { therapistId: req.user.id, clientRowId: clients[0].id };
}

const startThread = asyncHandler(async (req, res) => {
  const who = await resolveParticipants(req);
  if (who.error) return fail(res, who.error, who.status);

  let threads = await query(
    `SELECT * FROM chat_threads WHERE therapist_id = :tid AND client_id = :cid`,
    { tid: who.therapistId, cid: who.clientRowId }
  );
  if (!threads.length) {
    const result = await query(
      `INSERT INTO chat_threads (therapist_id, client_id) VALUES (:tid, :cid)`,
      { tid: who.therapistId, cid: who.clientRowId }
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
    pushNewMessage(req, threads[0], req.body.message);
  }
  return ok(res, { thread: threads[0] }, 'Chat ready', 201);
});

const sendMessage = asyncHandler(async (req, res) => {
  const thread = await findOwnThread(req, req.params.id);
  if (!thread) return fail(res, 'Chat not found', 404);
  const result = await query(
    `INSERT INTO chat_messages (thread_id, sender_user_id, body) VALUES (:tid, :uid, :body)`,
    { tid: req.params.id, uid: req.user.id, body: req.body.body }
  );
  await query(`UPDATE chat_threads SET last_message_at = NOW() WHERE id = :id`, {
    id: req.params.id,
  });
  const rows = await query(`SELECT * FROM chat_messages WHERE id = :id`, { id: result.insertId });
  pushNewMessage(req, thread, req.body.body);
  return ok(res, { message: rows[0] }, 'Sent', 201);
});

module.exports = { startSchema, messageSchema, listThreads, getMessages, startThread, sendMessage };
