const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const contactSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  subject: Joi.string().required(),
  message: Joi.string().required(),
});

const problemSchema = Joi.object({
  category: Joi.string().required(),
  description: Joi.string().required(),
  attachment_url: Joi.string().uri().allow('', null),
});

const faqs = asyncHandler(async (req, res) => {
  const locale = req.query.locale === 'ar' ? 'ar' : 'en';
  const rows = await query(
    `SELECT id,
            IF(:locale = 'ar' AND question_ar IS NOT NULL, question_ar, question_en) AS question,
            IF(:locale = 'ar' AND answer_ar IS NOT NULL, answer_ar, answer_en) AS answer,
            sort_order
     FROM faqs WHERE is_active = 1 ORDER BY sort_order ASC`,
    { locale }
  );
  return ok(res, { faqs: rows });
});

const listPolicies = asyncHandler(async (_req, res) => {
  const rows = await query(`SELECT slug, title_en, title_ar, updated_at FROM policies ORDER BY slug`);
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

const contact = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO contact_messages (user_id, name, email, subject, message)
     VALUES (:uid, :name, :email, :subject, :message)`,
    {
      uid: req.user?.id || null,
      name: p.name,
      email: p.email,
      subject: p.subject,
      message: p.message,
    }
  );
  return ok(res, { id: result.insertId }, 'Message received', 201);
});

const reportProblem = asyncHandler(async (req, res) => {
  const p = req.body;
  const result = await query(
    `INSERT INTO problem_reports (user_id, category, description, attachment_url)
     VALUES (:uid, :category, :description, :attachment_url)`,
    {
      uid: req.user.id,
      category: p.category,
      description: p.description,
      attachment_url: p.attachment_url || null,
    }
  );
  return ok(res, { id: result.insertId }, 'Problem reported', 201);
});

module.exports = {
  contactSchema,
  problemSchema,
  faqs,
  listPolicies,
  getPolicy,
  contact,
  reportProblem,
};
