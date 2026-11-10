/** Shared Progress-tab constants (mood scoring, cause/symptom tag sets). */

/** Mood label → score (5 = best). Unknown labels are ignored when scoring. */
const MOOD_SCORES = Object.freeze({
  happy: 5,
  calm: 4,
  balanced: 4,
  neutral: 3,
  tired: 2,
  nervous: 2,
  lonely: 2,
  anxious: 2,
  stressed: 2,
  sad: 1,
  scared: 1,
  angry: 1,
});

/** Canonical label for a rounded score (used for average_mood.label). */
const SCORE_TO_LABEL = Object.freeze({
  5: 'happy',
  4: 'calm',
  3: 'neutral',
  2: 'tired',
  1: 'sad',
});

/** Cause tags the app may put in mood_checkins.tags (Frequent Trigger uses these only). */
const CAUSE_LABELS = Object.freeze([
  'Marital Relationship',
  'Family',
  'Work',
  'Studies',
  'Money',
  'Sleep',
  'Health',
  'Loneliness',
  'Other Cause',
]);

/** Symptom tags that share the same tags array — counted separately for ai_input. */
const SYMPTOM_LABELS = Object.freeze([
  'Racing Thoughts',
  'Distress',
  'Fatigue',
  'Headache',
  'Want to Cry',
  'Insomnia',
  'Difficulty Concentrating',
]);

const CAUSE_SET = new Set(CAUSE_LABELS.map((s) => s.toLowerCase()));
const SYMPTOM_SET = new Set(SYMPTOM_LABELS.map((s) => s.toLowerCase()));
const CAUSE_BY_LOWER = Object.fromEntries(CAUSE_LABELS.map((s) => [s.toLowerCase(), s]));
const SYMPTOM_BY_LOWER = Object.fromEntries(SYMPTOM_LABELS.map((s) => [s.toLowerCase(), s]));

const WEEKDAYS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

function moodScore(label) {
  if (!label) return null;
  const score = MOOD_SCORES[String(label).trim().toLowerCase()];
  return score == null ? null : score;
}

/** Nearest canonical mood label for a numeric average score. */
function labelForScore(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const keys = [5, 4, 3, 2, 1];
  let best = keys[0];
  let bestDist = Math.abs(score - best);
  for (const k of keys) {
    const d = Math.abs(score - k);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return SCORE_TO_LABEL[best];
}

function matchCause(tag) {
  if (!tag) return null;
  const key = String(tag).trim().toLowerCase();
  return CAUSE_BY_LOWER[key] || null;
}

function matchSymptom(tag) {
  if (!tag) return null;
  const key = String(tag).trim().toLowerCase();
  return SYMPTOM_BY_LOWER[key] || null;
}

function parseTags(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

module.exports = {
  MOOD_SCORES,
  SCORE_TO_LABEL,
  CAUSE_LABELS,
  SYMPTOM_LABELS,
  CAUSE_SET,
  SYMPTOM_SET,
  WEEKDAYS,
  moodScore,
  labelForScore,
  matchCause,
  matchSymptom,
  parseTags,
};
