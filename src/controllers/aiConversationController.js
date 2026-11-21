const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).allow('', null),
});

const patchSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).required(),
});

const appendMessagesSchema = Joi.object({
  messages: Joi.array()
    .items(
      Joi.object({
        role: Joi.string().valid('user', 'assistant').required(),
        content: Joi.string().trim().min(1).max(8000).required(),
      })
    )
    .min(1)
    .max(10)
    .required(),
});

function previewText(content, max = 120) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

async function ownedConversation(userId, conversationId) {
  const [row] = await query(
    `SELECT id, user_id, title, last_message_at, created_at, updated_at
     FROM ai_conversations
     WHERE id = :id AND user_id = :uid
     LIMIT 1`,
    { id: conversationId, uid: userId }
  );
  return row || null;
}

const listConversations = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT c.id, c.title, c.last_message_at, c.created_at,
            (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT m.content FROM ai_messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.id DESC LIMIT 1) AS last_content
     FROM ai_conversations c
     WHERE c.user_id = :uid
       AND EXISTS (SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id)
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT 100`,
    { uid: req.user.id }
  );

  const conversations = rows.map((row) => ({
    id: row.id,
    title: row.title || null,
    preview: previewText(row.last_content),
    message_count: Number(row.message_count) || 0,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
  }));

  return ok(res, { conversations });
});

const createConversation = asyncHandler(async (req, res) => {
  const title = req.body.title ? String(req.body.title).trim() : null;
  const result = await query(
    `INSERT INTO ai_conversations (user_id, title) VALUES (:uid, :title)`,
    { uid: req.user.id, title: title || null }
  );
  const [conversation] = await query(
    `SELECT id, title, created_at FROM ai_conversations WHERE id = :id`,
    { id: result.insertId }
  );
  return ok(res, { conversation }, 'Created', 201);
});

const getMessages = asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user.id, req.params.id);
  if (!conversation) return fail(res, 'Conversation not found', 404);

  const messages = await query(
    `SELECT id, role, content, created_at
     FROM ai_messages
     WHERE conversation_id = :cid
     ORDER BY id ASC`,
    { cid: conversation.id }
  );

  return ok(res, {
    conversation: { id: conversation.id, title: conversation.title || null },
    messages,
  });
});

const appendMessages = asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user.id, req.params.id);
  if (!conversation) return fail(res, 'Conversation not found', 404);

  const items = req.body.messages;
  await withTransaction(async (conn) => {
    for (const item of items) {
      await conn.execute(
        `INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)`,
        [conversation.id, item.role, item.content]
      );
    }
    await conn.execute(`UPDATE ai_conversations SET last_message_at = NOW() WHERE id = ?`, [
      conversation.id,
    ]);
  });

  return ok(res, { saved: items.length }, 'Saved', 201);
});

const patchConversation = asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user.id, req.params.id);
  if (!conversation) return fail(res, 'Conversation not found', 404);

  const title = String(req.body.title).trim();
  await query(`UPDATE ai_conversations SET title = :title WHERE id = :id AND user_id = :uid`, {
    title,
    id: conversation.id,
    uid: req.user.id,
  });

  return ok(res, { conversation: { id: conversation.id, title } }, 'Updated');
});

const deleteConversation = asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user.id, req.params.id);
  if (!conversation) return fail(res, 'Conversation not found', 404);

  await query(`DELETE FROM ai_conversations WHERE id = :id AND user_id = :uid`, {
    id: conversation.id,
    uid: req.user.id,
  });

  return ok(res, null, 'Deleted');
});

module.exports = {
  createSchema,
  patchSchema,
  appendMessagesSchema,
  listConversations,
  createConversation,
  getMessages,
  appendMessages,
  patchConversation,
  deleteConversation,
};
