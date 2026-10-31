const { query } = require('../config/db');
const { notify } = require('./notify');

// Working with children needs a specialized certification: a degree flagged
// `certifies_age_group = 'children'` that has its document attached.
async function hasChildCertification(userId) {
  const [row] = await query(
    `SELECT d.id FROM therapist_degrees d
     JOIN credential_documents c ON c.owner_type = 'degree' AND c.owner_id = d.id
     WHERE d.therapist_id = :uid AND d.certifies_age_group = 'children' LIMIT 1`,
    { uid: userId }
  );
  return !!row;
}

/**
 * If the therapist still offers sessions to children but no longer has the
 * certification on file (degree removed or its document deleted), drop
 * `children` from their scope and tell them. Returns true when it changed.
 */
async function enforceChildCertification(userId) {
  const [row] = await query(`SELECT practice_scope FROM therapist_profiles WHERE user_id = :uid`, { uid: userId });
  let scope = row?.practice_scope;
  if (typeof scope === 'string') {
    try {
      scope = JSON.parse(scope);
    } catch {
      scope = null;
    }
  }
  if (!scope || !Array.isArray(scope.age_groups) || !scope.age_groups.includes('children')) return false;
  if (await hasChildCertification(userId)) return false;
  scope.age_groups = scope.age_groups.filter((g) => g !== 'children');
  await query(`UPDATE therapist_profiles SET practice_scope = :scope WHERE user_id = :uid`, {
    scope: JSON.stringify(scope),
    uid: userId,
  });
  await notify(userId, {
    title: 'Children removed from your practice scope',
    body: 'Your child-therapy certification is no longer on file, so Children was removed. Add it again under License & Credentials to re-enable it.',
    type: 'general',
    category: 'clinical_alerts',
  });
  return true;
}

module.exports = { hasChildCertification, enforceChildCertification };
