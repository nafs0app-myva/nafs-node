const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const identitySchema = Joi.object({
  full_name: Joi.string().min(2).max(120).required(),
  identity_number: Joi.string().required(),
  gender: Joi.string().valid('male', 'female', 'unspecified').required(),
  date_of_birth: Joi.date().iso().required(),
  bio: Joi.string().allow('', null),
  working_capacity: Joi.string().valid('individual', 'team').default('individual'),
  years_experience: Joi.number().integer().min(0).default(0),
  licenses: Joi.array()
    .items(
      Joi.object({
        license_number: Joi.string().required(),
        expiry_date: Joi.date().iso().allow(null),
        issuer: Joi.string().allow('', null),
      })
    )
    .default([]),
  degrees: Joi.array()
    .items(
      Joi.object({
        degree_title: Joi.string().required(),
        institution: Joi.string().required(),
        year_awarded: Joi.number().integer().allow(null),
      })
    )
    .default([]),
});

const experienceSchema = Joi.object({
  years_experience: Joi.number().integer().min(0).required(),
  specialization_ids: Joi.array().items(Joi.number().integer()).min(1).required(),
});

const adminTechSchema = Joi.object({
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  phone: Joi.string().allow('', null),
  timezone: Joi.string().default('Asia/Riyadh'),
  video_provider: Joi.string().default('custom'),
  video_meeting_url: Joi.string().uri().allow('', null),
  admin_notes: Joi.string().allow('', null),
});

async function getOrCreateApp(userId) {
  let rows = await query(`SELECT * FROM therapist_applications WHERE user_id = :id`, { id: userId });
  if (!rows.length) {
    await query(`INSERT INTO therapist_applications (user_id) VALUES (:id)`, { id: userId });
    rows = await query(`SELECT * FROM therapist_applications WHERE user_id = :id`, { id: userId });
  }
  return rows[0];
}

const listSpecializations = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, slug, name_en, name_ar FROM specializations WHERE is_active = 1 ORDER BY name_en`
  );
  return ok(res, { specializations: rows });
});

const getStatus = asyncHandler(async (req, res) => {
  const app = await getOrCreateApp(req.user.id);
  return ok(res, {
    status: app.status,
    step: app.step,
    submitted_at: app.submitted_at,
    review_notes: app.review_notes,
  });
});

const getApplication = asyncHandler(async (req, res) => {
  const app = await getOrCreateApp(req.user.id);
  return ok(res, { application: app });
});

const saveIdentity = asyncHandler(async (req, res) => {
  const p = req.body;
  await getOrCreateApp(req.user.id);
  await query(
    `UPDATE therapist_applications
     SET identity_payload = :payload, step = 'experience', updated_at = NOW()
     WHERE user_id = :uid AND status IN ('draft','rejected')`,
    { payload: JSON.stringify(p), uid: req.user.id }
  );
  await query(
    `UPDATE users SET full_name = :full_name WHERE id = :uid`,
    { full_name: p.full_name, uid: req.user.id }
  );
  await query(
    `INSERT INTO therapist_profiles
      (user_id, identity_number, gender, date_of_birth, bio, working_capacity, years_experience)
     VALUES (:uid, :identity_number, :gender, :date_of_birth, :bio, :working_capacity, :years_experience)
     ON DUPLICATE KEY UPDATE
       identity_number = VALUES(identity_number),
       gender = VALUES(gender),
       date_of_birth = VALUES(date_of_birth),
       bio = VALUES(bio),
       working_capacity = VALUES(working_capacity),
       years_experience = VALUES(years_experience)`,
    {
      uid: req.user.id,
      identity_number: p.identity_number,
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      bio: p.bio || null,
      working_capacity: p.working_capacity,
      years_experience: p.years_experience,
    }
  );

  await query(`DELETE FROM therapist_licenses WHERE therapist_id = :uid`, { uid: req.user.id });
  for (const lic of p.licenses || []) {
    await query(
      `INSERT INTO therapist_licenses (therapist_id, license_number, expiry_date, issuer)
       VALUES (:uid, :license_number, :expiry_date, :issuer)`,
      {
        uid: req.user.id,
        license_number: lic.license_number,
        expiry_date: lic.expiry_date || null,
        issuer: lic.issuer || null,
      }
    );
  }
  await query(`DELETE FROM therapist_degrees WHERE therapist_id = :uid`, { uid: req.user.id });
  for (const deg of p.degrees || []) {
    await query(
      `INSERT INTO therapist_degrees (therapist_id, degree_title, institution, year_awarded)
       VALUES (:uid, :degree_title, :institution, :year_awarded)`,
      {
        uid: req.user.id,
        degree_title: deg.degree_title,
        institution: deg.institution,
        year_awarded: deg.year_awarded || null,
      }
    );
  }

  return ok(res, null, 'Identity step saved');
});

const saveExperience = asyncHandler(async (req, res) => {
  const p = req.body;
  await getOrCreateApp(req.user.id);
  await query(
    `UPDATE therapist_applications
     SET experience_payload = :payload, step = 'admin_tech'
     WHERE user_id = :uid AND status IN ('draft','rejected')`,
    { payload: JSON.stringify(p), uid: req.user.id }
  );
  await query(`UPDATE therapist_profiles SET years_experience = :y WHERE user_id = :uid`, {
    y: p.years_experience,
    uid: req.user.id,
  });
  await query(`DELETE FROM therapist_specializations WHERE therapist_id = :uid`, { uid: req.user.id });
  for (const sid of p.specialization_ids) {
    await query(
      `INSERT IGNORE INTO therapist_specializations (therapist_id, specialization_id)
       VALUES (:uid, :sid)`,
      { uid: req.user.id, sid }
    );
  }
  return ok(res, null, 'Experience step saved');
});

const saveAdminTech = asyncHandler(async (req, res) => {
  const p = req.body;
  await getOrCreateApp(req.user.id);
  await query(
    `UPDATE therapist_applications
     SET admin_tech_payload = :payload, step = 'admin_tech'
     WHERE user_id = :uid AND status IN ('draft','rejected')`,
    { payload: JSON.stringify(p), uid: req.user.id }
  );
  await query(
    `UPDATE therapist_profiles
     SET city = :city, country = :country, address = :address, timezone = :timezone,
         video_provider = :video_provider, video_meeting_url = :video_meeting_url,
         admin_notes = :admin_notes
     WHERE user_id = :uid`,
    {
      uid: req.user.id,
      city: p.city || null,
      country: p.country || null,
      address: p.address || null,
      timezone: p.timezone,
      video_provider: p.video_provider,
      video_meeting_url: p.video_meeting_url || null,
      admin_notes: p.admin_notes || null,
    }
  );
  if (p.phone) {
    await query(`UPDATE users SET phone = :phone WHERE id = :uid`, {
      phone: p.phone,
      uid: req.user.id,
    });
  }
  return ok(res, null, 'Admin/tech step saved');
});

const submit = asyncHandler(async (req, res) => {
  const app = await getOrCreateApp(req.user.id);
  if (!app.identity_payload || !app.experience_payload || !app.admin_tech_payload) {
    return fail(res, 'Complete identity, experience, and admin/tech steps before submit', 422);
  }
  await query(
    `UPDATE therapist_applications
     SET status = 'submitted', step = 'submitted', submitted_at = NOW()
     WHERE user_id = :uid`,
    { uid: req.user.id }
  );
  return ok(res, { status: 'submitted' }, 'Application received');
});

module.exports = {
  identitySchema,
  experienceSchema,
  adminTechSchema,
  listSpecializations,
  getStatus,
  getApplication,
  saveIdentity,
  saveExperience,
  saveAdminTech,
  submit,
};
