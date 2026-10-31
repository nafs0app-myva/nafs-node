const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { sendMail } = require('../services/emailService');
const { notify } = require('../utils/notify');
const multer = require('multer');

const contactSchema = Joi.object({
  name: Joi.string().trim().max(120).required(),
  email: Joi.string().trim().email().max(190).required(),
  subject: Joi.string().trim().max(160).required(),
  message: Joi.string().trim().min(5).max(4000).required(),
});

const replySchema = Joi.object({
  status: Joi.string().valid('new', 'in_progress', 'closed'),
  reply: Joi.string().trim().max(4000),
}).min(1);

const PROBLEM_CATEGORIES = ['Bug / Crash', 'Sync Issue', 'Account & Billing', 'Content Concern', 'Something Else'];

const problemSchema = Joi.object({
  category: Joi.string().valid(...PROBLEM_CATEGORIES).required(),
  description: Joi.string().trim().min(10).max(4000).required(),
  attachment_url: Joi.string().uri().allow('', null),
  // Where it happened, so it can be reproduced: platform, OS version, app screen...
  device_info: Joi.object({
    platform: Joi.string().max(40),
    os_version: Joi.string().max(120),
    app_version: Joi.string().max(40),
    role: Joi.string().max(20),
  }).unknown(false),
});

const problemUpdateSchema = Joi.object({
  status: Joi.string().valid('open', 'resolved', 'closed'),
  resolution: Joi.string().trim().max(4000),
}).min(1);

const faqs = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  // `audience` = therapist | client; rows marked `all` are shown to both.
  const audience = req.query.audience === 'therapist' ? 'therapist' : 'client';
  const rows = await query(
    `SELECT id,
            IF(:locale = 'ar' AND question_ar IS NOT NULL, question_ar, question_en) AS question,
            IF(:locale = 'ar' AND answer_ar IS NOT NULL, answer_ar, answer_en) AS answer,
            category, sort_order
     FROM faqs WHERE is_active = 1 AND audience IN ('all', :audience) ORDER BY sort_order ASC`,
    { locale, audience }
  );
  return ok(res, { faqs: rows });
});

const listPolicies = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  // `audience` = therapist | client; rows marked `all` are shown to both.
  const audience = req.query.audience === 'therapist' ? 'therapist' : 'client';
  // Optional `q` matches the title or the full text in either language.
  const q = String(req.query.q || '').trim();
  let sql = `SELECT slug,
            IF(:locale = 'ar' AND title_ar IS NOT NULL, title_ar, title_en) AS title,
            updated_at
     FROM policies WHERE audience IN ('all', :audience)`;
  const params = { locale, audience };
  if (q) {
    sql += ` AND (title_en LIKE :q OR title_ar LIKE :q OR body_en LIKE :q OR body_ar LIKE :q)`;
    params.q = `%${q}%`;
  }
  sql += ` ORDER BY sort_order, slug`;
  const rows = await query(sql, params);
  return ok(res, { policies: rows });
});

const getPolicy = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  const rows = await query(`SELECT * FROM policies WHERE slug = :slug`, { slug: req.params.slug });
  if (!rows.length) return fail(res, 'Policy not found', 404);
  const p = rows[0];
  return ok(res, {
    policy: {
      slug: p.slug,
      title: locale === 'ar' && p.title_ar ? p.title_ar : p.title_en,
      body: locale === 'ar' && p.body_ar ? p.body_ar : p.body_en,
      updated_at: p.updated_at,
    },
  });
});

const referenceOf = (id) => `NAFS-C-${String(id).padStart(5, '0')}`;

// POST /contact - stores the message, emails the support team (replies go straight
// to the sender) and sends the sender a confirmation with a reference number.
const contact = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO contact_messages (user_id, name, email, subject, message)
     VALUES (:uid, :name, :email, :subject, :message)`,
    { uid: req.user?.id || null, name: p.name, email: p.email, subject: p.subject, message: p.message }
  );
  const reference = referenceOf(result.insertId);
  sendMail({
    to: env.supportEmail,
    replyTo: p.email,
    subject: `[${reference}] ${p.subject}`,
    text: `From: ${p.name} <${p.email}>${req.user ? ` (user #${req.user.id}, ${req.user.role})` : ''}\n\n${p.message}`,
    purpose: 'contact_support',
  }).catch(() => {});
  sendMail({
    to: p.email,
    subject: `We received your message (${reference})`,
    text: `Hi ${p.name},\n\nThanks for contacting Nafs. Your reference is ${reference}. We usually reply within 24 hours.\n\nYour message:\n${p.message}`,
    purpose: 'contact_confirmation',
  }).catch(() => {});
  return ok(res, { id: result.insertId, reference }, 'Message received', 201);
});

// GET /contact/messages - the signed-in user's own messages and our replies.
const myMessages = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, subject, message, status, reply, replied_at, created_at FROM contact_messages
     WHERE user_id = :uid ORDER BY id DESC LIMIT 50`,
    { uid: req.user.id }
  );
  return ok(res, { messages: rows.map((r) => ({ ...r, reference: referenceOf(r.id) })) });
});

// PATCH /contact/:id (admin) - set the status and/or reply; a reply is emailed and notified.
const replyToMessage = asyncHandler(async (req, res) => {
  const [msg] = await query(`SELECT * FROM contact_messages WHERE id = :id`, { id: req.params.id });
  if (!msg) return fail(res, 'Message not found', 404);
  const { status, reply } = req.body;
  await query(
    `UPDATE contact_messages SET status = COALESCE(:status, status), reply = COALESCE(:reply, reply),
            replied_at = IF(:reply IS NULL, replied_at, NOW()) WHERE id = :id`,
    { id: msg.id, status: status || (reply ? 'in_progress' : null), reply: reply || null }
  );
  if (reply) {
    const reference = referenceOf(msg.id);
    sendMail({ to: msg.email, subject: `Re: ${msg.subject} (${reference})`, text: reply, purpose: 'contact_reply' }).catch(() => {});
    await notify(msg.user_id, { title: 'Support replied to your message', body: `${reference}: ${reply.slice(0, 140)}`, type: 'support', category: 'clinical_alerts' });
  }
  return ok(res, null, 'Updated');
});

const problemRef = (id) => `NAFS-P-${String(id).padStart(5, '0')}`;

const categories = asyncHandler(async (_req, res) => ok(res, { categories: PROBLEM_CATEGORIES }));

// POST /report-problem - stores the report, emails the support team and confirms to the reporter.
const reportProblem = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO problem_reports (user_id, category, description, attachment_url, device_info)
     VALUES (:uid, :category, :description, :attachment_url, :device_info)`,
    {
      uid: req.user.id,
      category: p.category,
      description: p.description,
      attachment_url: p.attachment_url || null,
      device_info: p.device_info ? JSON.stringify(p.device_info) : null,
    }
  );
  const reference = problemRef(result.insertId);
  const [user] = await query(`SELECT email, full_name FROM users WHERE id = :id`, { id: req.user.id });
  const device = p.device_info ? `\n\nDevice: ${JSON.stringify(p.device_info)}` : '';
  sendMail({
    to: env.supportEmail,
    replyTo: user?.email,
    subject: `[${reference}] ${p.category}`,
    text: `From: ${user?.full_name || 'user'} <${user?.email}> (user #${req.user.id}, ${req.user.role})\n\n${p.description}${device}`,
    purpose: 'problem_report',
  }).catch(() => {});
  await notify(req.user.id, {
    title: 'Problem report received',
    body: `Thanks - your report ${reference} is with our team. We will update you here.`,
    type: 'support',
    category: 'clinical_alerts',
  });
  return ok(res, { id: result.insertId, reference }, 'Problem reported', 201);
});

const SCREENSHOT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(SCREENSHOT_MIMES.has(file.mimetype) ? null : new Error('INVALID_IMAGE'), SCREENSHOT_MIMES.has(file.mimetype)),
}).single('screenshot');

// POST /report-problem/:id/screenshot (multipart field `screenshot`; JPG/PNG/WebP, 4 MB)
const uploadScreenshot = (req, res, next) =>
  screenshotUpload(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_IMAGE') return fail(res, 'Screenshot must be a JPG, PNG or WebP image', 422);
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'Screenshot must be 4 MB or smaller', 422);
      return next(err);
    }
    try {
      if (!req.file) return fail(res, 'Attach the image as the "screenshot" field', 422);
      const result = await query(
        `UPDATE problem_reports SET screenshot = :data, screenshot_mime = :mime WHERE id = :id AND user_id = :uid`,
        { data: req.file.buffer, mime: req.file.mimetype, id: req.params.id, uid: req.user.id }
      );
      if (!result.affectedRows) return fail(res, 'Report not found', 404);
      return ok(res, null, 'Screenshot attached', 201);
    } catch (e) {
      return next(e);
    }
  });

// GET /report-problem/:id/screenshot - the reporter or an admin.
const getScreenshot = asyncHandler(async (req, res) => {
  const [row] = await query(`SELECT user_id, screenshot, screenshot_mime FROM problem_reports WHERE id = :id`, { id: req.params.id });
  if (!row || !row.screenshot || (row.user_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 'Screenshot not found', 404);
  res.set('Content-Type', row.screenshot_mime);
  res.set('Cache-Control', 'private, max-age=0');
  return res.send(row.screenshot);
});

// GET /report-problem - the signed-in user's own reports and their status.
const myProblems = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, category, description, status, resolution, resolved_at, created_at,
            (screenshot IS NOT NULL) AS has_screenshot
     FROM problem_reports WHERE user_id = :uid ORDER BY id DESC LIMIT 50`,
    { uid: req.user.id }
  );
  return ok(res, { reports: rows.map((r) => ({ ...r, has_screenshot: !!r.has_screenshot, reference: problemRef(r.id) })) });
});

// PATCH /report-problem/:id (admin) - change status / add a resolution note; the reporter is told.
const updateProblem = asyncHandler(async (req, res) => {
  const [report] = await query(`SELECT * FROM problem_reports WHERE id = :id`, { id: req.params.id });
  if (!report) return fail(res, 'Report not found', 404);
  const { status, resolution } = req.body;
  await query(
    `UPDATE problem_reports SET status = COALESCE(:status, status), resolution = COALESCE(:resolution, resolution),
            resolved_at = IF(:status IN ('resolved','closed'), NOW(), resolved_at) WHERE id = :id`,
    { id: report.id, status: status || null, resolution: resolution || null }
  );
  await notify(report.user_id, {
    title: `Problem report ${status || 'updated'}`,
    body: `${problemRef(report.id)}${resolution ? `: ${resolution.slice(0, 140)}` : ''}`,
    type: 'support',
    category: 'clinical_alerts',
  });
  return ok(res, null, 'Updated');
});

module.exports = {
  contactSchema,
  replySchema,
  myMessages,
  replyToMessage,
  problemSchema,
  problemUpdateSchema,
  categories,
  uploadScreenshot,
  getScreenshot,
  myProblems,
  updateProblem,
  faqs,
  listPolicies,
  getPolicy,
  contact,
  reportProblem,
};
