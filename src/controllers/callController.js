const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { notify } = require('../utils/notify');
const { sendPush } = require('../services/pushService');

// How long a call rings before it counts as missed.
const RING_SECONDS = 45;

const cancelSchema = Joi.object({ reason: Joi.string().valid('timeout', 'hangup').default('hangup') });

const signal = (userId, type, call, extra = {}) =>
  sendPush(userId, {
    title: 'Call',
    body: type,
    dataOnly: true,
    data: { type, call_id: call.id, session_id: call.session_id, ...extra },
  }).catch((e) => console.error('[call] push failed:', e.message));

const view = (c) => ({
  id: c.id,
  session_id: c.session_id,
  status: c.status,
  ring_seconds: RING_SECONDS,
  channel: `nafs-session-${c.session_id}`,
});

/** Marks a ring that ran out as missed (once) and tells the callee. */
async function expireIfStale(call) {
  if (call.status !== 'ringing') return call;
  const [{ stale }] = await query(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) > :limit AS stale FROM session_calls WHERE id = :id`,
    { limit: RING_SECONDS + 5, id: call.id }
  );
  if (!stale) return call;
  await markMissed(call);
  return { ...call, status: 'missed' };
}

async function markMissed(call) {
  const done = await query(`UPDATE session_calls SET status = 'missed' WHERE id = :id AND status = 'ringing'`, { id: call.id });
  if (!done.affectedRows) return;
  const [caller] = await query(`SELECT full_name FROM users WHERE id = :id`, { id: call.caller_id });
  signal(call.callee_id, 'call_cancelled', call);
  await notify(call.callee_id, {
    title: 'Missed call',
    body: `You missed a call from ${caller?.full_name || 'your session partner'}.`,
    type: 'session',
    data: { session_id: call.session_id },
  });
}

// POST /sessions/:id/call/ring - therapist or client rings the other side.
const ring = asyncHandler(async (req, res) => {
  const [s] = await query(
    `SELECT s.id, s.therapist_id, s.session_type, s.status, c.client_user_id
     FROM sessions s LEFT JOIN therapist_clients c ON c.id = s.client_id WHERE s.id = :id`,
    { id: req.params.id }
  );
  const uid = Number(req.user.id);
  if (!s || (s.therapist_id !== uid && s.client_user_id !== uid)) return fail(res, 'Session not found', 404);
  if (s.session_type === 'in_person') return fail(res, 'This is an in-person session', 400);
  if (['cancelled', 'completed', 'no_show'].includes(s.status)) return fail(res, `Session is ${s.status}`, 400);
  const calleeId = s.therapist_id === uid ? s.client_user_id : s.therapist_id;
  if (!calleeId) return fail(res, 'This client has no app account to call', 422);

  // Only one live ring per session: a new one replaces the old.
  const stale = await query(`SELECT * FROM session_calls WHERE session_id = :sid AND status = 'ringing'`, { sid: s.id });
  for (const old of stale) {
    await query(`UPDATE session_calls SET status = 'cancelled' WHERE id = :id`, { id: old.id });
    signal(old.callee_id, 'call_cancelled', old);
  }
  const result = await query(`INSERT INTO session_calls (session_id, caller_id, callee_id) VALUES (:sid, :caller, :callee)`, {
    sid: s.id,
    caller: uid,
    callee: calleeId,
  });
  const call = { id: result.insertId, session_id: s.id, caller_id: uid, callee_id: calleeId, status: 'ringing' };
  const [caller] = await query(`SELECT full_name, avatar_url FROM users WHERE id = :id`, { id: uid });
  const push = await sendPush(calleeId, {
    title: 'Incoming call',
    body: caller?.full_name || 'Incoming call',
    dataOnly: true,
    data: {
      type: 'incoming_call',
      call_id: call.id,
      session_id: s.id,
      caller_name: caller?.full_name || 'Nafs',
      caller_avatar: caller?.avatar_url || '',
      is_video: s.session_type === 'video' ? 1 : 0,
      ring_seconds: RING_SECONDS,
    },
  }).catch((e) => ({ delivered: 0, mode: e.message }));
  return ok(res, { call: view(call), delivered: push.delivered || 0 }, 'Ringing', 201);
});

async function loadCall(req, res) {
  const [call] = await query(`SELECT * FROM session_calls WHERE id = :id`, { id: req.params.id });
  if (!call || ![call.caller_id, call.callee_id].includes(Number(req.user.id))) {
    fail(res, 'Call not found', 404);
    return null;
  }
  return expireIfStale(call);
}

// GET /calls/:id - current state (the caller polls this as a fallback to push).
const status = asyncHandler(async (req, res) => {
  const call = await loadCall(req, res);
  if (call) return ok(res, { call: view(call) });
});

const respond = (to) =>
  asyncHandler(async (req, res) => {
    const call = await loadCall(req, res);
    if (!call) return;
    if (call.callee_id !== Number(req.user.id)) return fail(res, 'Only the person being called can answer', 403);
    if (call.status !== 'ringing') return fail(res, `Call is already ${call.status}`, 409);
    await query(`UPDATE session_calls SET status = :to, answered_at = IF(:to = 'accepted', NOW(), NULL) WHERE id = :id AND status = 'ringing'`, {
      to,
      id: call.id,
    });
    signal(call.caller_id, to === 'accepted' ? 'call_accepted' : 'call_declined', call);
    return ok(res, { call: view({ ...call, status: to }) });
  });

// POST /calls/:id/cancel - the caller hangs up before an answer (or the ring timed out).
const cancel = asyncHandler(async (req, res) => {
  const call = await loadCall(req, res);
  if (!call) return;
  if (call.caller_id !== Number(req.user.id)) return fail(res, 'Only the caller can cancel', 403);
  if (call.status !== 'ringing') return ok(res, { call: view(call) });
  if (req.body.reason === 'timeout') {
    await markMissed(call);
    return ok(res, { call: view({ ...call, status: 'missed' }) });
  }
  await query(`UPDATE session_calls SET status = 'cancelled' WHERE id = :id AND status = 'ringing'`, { id: call.id });
  signal(call.callee_id, 'call_cancelled', call);
  return ok(res, { call: view({ ...call, status: 'cancelled' }) });
});

module.exports = { cancelSchema, ring, status, accept: respond('accepted'), decline: respond('declined'), cancel };
