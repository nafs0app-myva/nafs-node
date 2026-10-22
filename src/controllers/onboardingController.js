const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Shared onboarding endpoint for client + therapist.
 * Role is taken from the authenticated user (not the body).
 */
const saveSchema = Joi.object({
  step: Joi.string().max(64),
  completed: Joi.boolean(),
  // Shared user fields
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
  locale: Joi.string().valid('en', 'ar'),
  gender: Joi.string().valid('male', 'female', 'unspecified'),
  date_of_birth: Joi.date().iso().allow(null),
  city: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  timezone: Joi.string(),
  // Client
  goals: Joi.array().items(Joi.string()).max(20),
  concerns: Joi.array().items(Joi.string()).max(30),
  preferred_therapist_gender: Joi.string().valid('male', 'female', 'any'),
  about: Joi.string().allow('', null),
  emergency_contact_name: Joi.string().allow('', null),
  emergency_contact_phone: Joi.string().allow('', null),
  // Therapist (light first-run; full licensing still uses /application/*)
  bio: Joi.string().allow('', null),
  years_experience: Joi.number().integer().min(0),
  working_capacity: Joi.string().valid('individual', 'team'),
  specialization_ids: Joi.array().items(Joi.number().integer()),
  video_meeting_url: Joi.string().uri().allow('', null),
}).min(1);

function parseJsonField(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function getOrCreateOnboarding(userId, role) {
  let rows = await query(`SELECT * FROM user_onboarding WHERE user_id = :id`, { id: userId });
  if (!rows.length) {
    await query(`INSERT INTO user_onboarding (user_id, role) VALUES (:id, :role)`, {
      id: userId,
      role,
    });
    rows = await query(`SELECT * FROM user_onboarding WHERE user_id = :id`, { id: userId });
  }
  return rows[0];
}

async function patchTable(table, userId, map) {
  const updates = [];
  const params = { id: userId };
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) {
      updates.push(`${key} = :${key}`);
      params[key] = value;
    }
  }
  if (!updates.length) return;
  await query(`UPDATE ${table} SET ${updates.join(', ')} WHERE user_id = :id`, params);
}

async function loadOnboardingPayload(user) {
  const onboarding = await getOrCreateOnboarding(user.id, user.role);
  let profile = null;
  let goals = null;
  let specializations = [];

  if (user.role === 'client') {
    let profiles = await query(`SELECT * FROM client_profiles WHERE user_id = :id`, {
      id: user.id,
    });
    if (!profiles.length) {
      await query(
        `INSERT INTO client_profiles (user_id, preferred_language) VALUES (:id, :locale)`,
        { id: user.id, locale: user.locale || 'en' }
      );
      profiles = await query(`SELECT * FROM client_profiles WHERE user_id = :id`, { id: user.id });
    }
    profile = profiles[0]
      ? {
          ...profiles[0],
          concerns: parseJsonField(profiles[0].concerns),
          onboarding_completed: !!profiles[0].onboarding_completed,
        }
      : null;
    const goalRows = await query(`SELECT goals FROM user_goals WHERE user_id = :id`, {
      id: user.id,
    });
    goals = goalRows[0] ? parseJsonField(goalRows[0].goals) : [];
  } else {
    const profiles = await query(`SELECT * FROM therapist_profiles WHERE user_id = :id`, {
      id: user.id,
    });
    profile = profiles[0] || null;
    specializations = await query(
      `SELECT s.id, s.slug, s.name_en, s.name_ar
       FROM therapist_specializations ts
       JOIN specializations s ON s.id = ts.specialization_id
       WHERE ts.therapist_id = :id`,
      { id: user.id }
    );
  }

  return {
    role: user.role,
    step: onboarding.step,
    completed: !!onboarding.completed,
    completed_at: onboarding.completed_at,
    payload: parseJsonField(onboarding.payload),
    profile,
    goals,
    specializations,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      avatar_url: user.avatar_url,
      locale: user.locale,
    },
  };
}

const getOnboarding = asyncHandler(async (req, res) => {
  const users = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!users.length) return fail(res, 'User not found', 404);
  return ok(res, await loadOnboardingPayload(users[0]));
});

const saveOnboarding = asyncHandler(async (req, res) => {
  const users = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
  if (!users.length) return fail(res, 'User not found', 404);
  const user = users[0];
  const p = req.body;

  await getOrCreateOnboarding(user.id, user.role);

  const userSets = [];
  const userParams = { id: user.id };
  for (const key of ['full_name', 'phone', 'avatar_url', 'locale']) {
    if (p[key] !== undefined) {
      userSets.push(`${key} = :${key}`);
      userParams[key] = p[key];
    }
  }
  if (userSets.length) {
    await query(`UPDATE users SET ${userSets.join(', ')} WHERE id = :id`, userParams);
  }

  if (user.role === 'client') {
    await query(
      `INSERT INTO client_profiles (user_id, preferred_language) VALUES (:id, :locale)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      { id: user.id, locale: user.locale || 'en' }
    );
    await patchTable('client_profiles', user.id, {
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      city: p.city,
      country: p.country,
      timezone: p.timezone,
      preferred_language: p.locale,
      preferred_therapist_gender: p.preferred_therapist_gender,
      concerns: p.concerns !== undefined ? JSON.stringify(p.concerns) : undefined,
      about: p.about,
      emergency_contact_name: p.emergency_contact_name,
      emergency_contact_phone: p.emergency_contact_phone,
      onboarding_completed: p.completed === true ? 1 : undefined,
    });

    if (p.goals) {
      await query(
        `INSERT INTO user_goals (user_id, goals) VALUES (:id, :goals)
         ON DUPLICATE KEY UPDATE goals = VALUES(goals)`,
        { id: user.id, goals: JSON.stringify(p.goals) }
      );
    }
  } else {
    await query(
      `INSERT INTO therapist_profiles (user_id) VALUES (:id)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      { id: user.id }
    );
    await patchTable('therapist_profiles', user.id, {
      gender: p.gender,
      date_of_birth: p.date_of_birth,
      bio: p.bio,
      working_capacity: p.working_capacity,
      years_experience: p.years_experience,
      city: p.city,
      country: p.country,
      timezone: p.timezone,
      video_meeting_url: p.video_meeting_url,
    });

    if (Array.isArray(p.specialization_ids)) {
      await query(`DELETE FROM therapist_specializations WHERE therapist_id = :id`, {
        id: user.id,
      });
      for (const sid of p.specialization_ids) {
        await query(
          `INSERT IGNORE INTO therapist_specializations (therapist_id, specialization_id)
           VALUES (:id, :sid)`,
          { id: user.id, sid }
        );
      }
    }
  }

  const completed = !!p.completed;
  await query(
    `UPDATE user_onboarding
     SET step = :step,
         payload = :payload,
         completed = :completed,
         completed_at = IF(:completed = 1, COALESCE(completed_at, NOW()), completed_at),
         updated_at = NOW()
     WHERE user_id = :id`,
    {
      id: user.id,
      step: p.step || (completed ? 'done' : 'in_progress'),
      payload: JSON.stringify(p),
      completed: completed ? 1 : 0,
    }
  );

  const fresh = await query(`SELECT * FROM users WHERE id = :id`, { id: user.id });
  return ok(res, await loadOnboardingPayload(fresh[0]), 'Onboarding saved');
});

module.exports = { saveSchema, getOnboarding, saveOnboarding };
