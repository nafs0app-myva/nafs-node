const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Screen mapping (app ↔ API):
 * - Identity screen  → PUT /application/identity
 *     name, age OR date_of_birth, gender, licenses[], degrees[]
 *     (identity_number / bio / working_capacity optional)
 * - Experience screen → PUT /application/experience
 *     specialization_ids, years_experience and/or years_in_specialization
 * - Admin screen (fees + weekly schedule) → PUT /application/admin-tech
 *     session_fee_default + slots[]  (also writable via PUT /availability)
 *     city/country/address/video_* are optional (other screen / settings)
 */

const identitySchema = Joi.object({
  full_name: Joi.string().min(2).max(120).required(),
  gender: Joi.string().valid('male', 'female', 'unspecified').required(),
  // App may send age instead of DOB
  age: Joi.number().integer().min(18).max(100),
  date_of_birth: Joi.date().iso().allow(null),
  identity_number: Joi.string().allow('', null),
  bio: Joi.string().allow('', null),
  working_capacity: Joi.string().valid('individual', 'team').default('individual'),
  years_experience: Joi.number().integer().min(0).default(0),
  licenses: Joi.array()
    .items(
      Joi.object({
        license_number: Joi.string().required(),
        expiry_date: Joi.date().iso().allow(null),
        issuer: Joi.string().allow('', null), // authority
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
})
  .or('age', 'date_of_birth')
  .messages({
    'object.missing': 'Provide age or date_of_birth',
  });

const experienceSchema = Joi.object({
  years_experience: Joi.number().integer().min(0),
  // Collected on Experience screen — accepted and mapped to years_experience when needed
  years_in_specialization: Joi.number().integer().min(0),
  specialization_ids: Joi.array().items(Joi.number().integer()).min(1).required(),
}).or('years_experience', 'years_in_specialization');

const adminTechSchema = Joi.object({
  // Optional address / video (not on current Admin fees screen)
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  phone: Joi.string().allow('', null),
  timezone: Joi.string().default('Asia/Riyadh'),
  video_provider: Joi.string().default('custom'),
  video_meeting_url: Joi.string().uri().allow('', null),
  admin_notes: Joi.string().allow('', null),
  // Admin screen: session fee + weekly availability
  session_fee_default: Joi.number().min(0).allow(null),
  currency: Joi.string().default('SAR'),
  slots: Joi.array()
    .items(
      Joi.object({
        weekday: Joi.number().integer().min(0).max(6).required(),
        start_time: Joi.string().required(),
        end_time: Joi.string().required(),
        is_active: Joi.boolean().default(true),
      })
    )
    .default([]),
}).min(0);

function ageToDob(age) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Number(age));
  d.setMonth(0, 1);
  return d.toISOString().slice(0, 10);
}

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
  const dob = p.date_of_birth || (p.age != null ? ageToDob(p.age) : null);

  await query(
    `UPDATE therapist_applications
     SET identity_payload = :payload, step = 'experience', updated_at = NOW()
     WHERE user_id = :uid AND status IN ('draft','rejected')`,
    { payload: JSON.stringify({ ...p, date_of_birth: dob }), uid: req.user.id }
  );
  await query(`UPDATE users SET full_name = :full_name WHERE id = :uid`, {
    full_name: p.full_name,
    uid: req.user.id,
  });
  await query(
    `INSERT INTO therapist_profiles
      (user_id, identity_number, gender, date_of_birth, bio, working_capacity, years_experience)
     VALUES (:uid, :identity_number, :gender, :date_of_birth, :bio, :working_capacity, :years_experience)
     ON DUPLICATE KEY UPDATE
       identity_number = COALESCE(VALUES(identity_number), identity_number),
       gender = VALUES(gender),
       date_of_birth = COALESCE(VALUES(date_of_birth), date_of_birth),
       bio = COALESCE(VALUES(bio), bio),
       working_capacity = VALUES(working_capacity),
       years_experience = VALUES(years_experience)`,
    {
      uid: req.user.id,
      identity_number: p.identity_number || null,
      gender: p.gender,
      date_of_birth: dob,
      bio: p.bio || null,
      working_capacity: p.working_capacity || 'individual',
      years_experience: p.years_experience || 0,
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
  const years =
    p.years_experience != null ? p.years_experience : p.years_in_specialization != null
      ? p.years_in_specialization
      : 0;

  await query(
    `UPDATE therapist_applications
     SET experience_payload = :payload, step = 'admin_tech'
     WHERE user_id = :uid AND status IN ('draft','rejected')`,
    { payload: JSON.stringify(p), uid: req.user.id }
  );
  await query(`UPDATE therapist_profiles SET years_experience = :y WHERE user_id = :uid`, {
    y: years,
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
  return ok(res, { years_experience: years }, 'Experience step saved');
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
     SET city = COALESCE(:city, city),
         country = COALESCE(:country, country),
         address = COALESCE(:address, address),
         timezone = COALESCE(:timezone, timezone),
         video_provider = COALESCE(:video_provider, video_provider),
         video_meeting_url = COALESCE(:video_meeting_url, video_meeting_url),
         admin_notes = COALESCE(:admin_notes, admin_notes),
         session_fee_default = COALESCE(:session_fee_default, session_fee_default)
     WHERE user_id = :uid`,
    {
      uid: req.user.id,
      city: p.city ?? null,
      country: p.country ?? null,
      address: p.address ?? null,
      timezone: p.timezone || null,
      video_provider: p.video_provider || null,
      video_meeting_url: p.video_meeting_url ?? null,
      admin_notes: p.admin_notes ?? null,
      session_fee_default: p.session_fee_default ?? null,
    }
  );
  if (p.phone) {
    await query(`UPDATE users SET phone = :phone WHERE id = :uid`, {
      phone: p.phone,
      uid: req.user.id,
    });
  }

  // Admin screen weekly schedule — same shape as PUT /availability
  if (Array.isArray(p.slots) && p.slots.length) {
    await query(`DELETE FROM availability_slots WHERE therapist_id = :uid`, { uid: req.user.id });
    for (const slot of p.slots) {
      await query(
        `INSERT INTO availability_slots (therapist_id, weekday, start_time, end_time, is_active)
         VALUES (:uid, :weekday, :start_time, :end_time, :is_active)`,
        {
          uid: req.user.id,
          weekday: slot.weekday,
          start_time: slot.start_time,
          end_time: slot.end_time,
          is_active: slot.is_active === false ? 0 : 1,
        }
      );
    }
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
