const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Static exercise catalogue (same for every user). Kept in code rather than a
 * table — it is small, read-only and has no per-user state. Colours are hex
 * strings and icons are short keys the app maps to its own icon set.
 *
 *  GET /exercises       → { exercises: [summary...] }  (no instructions/sequence)
 *  GET /exercises/:id   → { exercise: full }           (instructions + sequence)
 */
const EXERCISES = [
  {
    id: 'understand_yourself',
    type: 'audio',
    category: 'Mindset',
    icon: 'location',
    title: 'Understand Yourself',
    subtitle: 'Try to understand yourself more deeply',
    accent: '#E2654A',
    card_background: '#FCE4DE',
    duration_minutes: 5,
    difficulty: 'beginner',
    tags: ['Anxiety'],
    benefit_label: 'Self Awareness',
    description:
      'A short guided reflection that helps you check in with your own thoughts and feelings, ' +
      'building the self-awareness that underlies most other mental wellness practices.',
    instructions: [
      { title: 'Pause', body: 'Find a quiet moment and sit comfortably.' },
      { title: 'Reflect', body: 'Ask yourself how you are really feeling right now, without judgment.' },
      { title: 'Name It', body: 'Put a word or two to what comes up — just naming it helps.' },
    ],
  },
  {
    id: 'box_breathing',
    type: 'audio',
    category: 'Breathwork',
    icon: 'air',
    title: 'Box Breathing',
    subtitle: '4-4-4-4 rhythm to center your nervous system',
    accent: '#1E9D5C',
    card_background: '#DCF3E6',
    duration_minutes: 3,
    difficulty: 'beginner',
    tags: ['Anxiety', 'Stress'],
    benefit_label: 'Anxiety Relief',
    description:
      'A powerful, yet simple, relaxation technique that aims to return breathing to its normal ' +
      'rhythm. It helps clear the mind, relax the body, and improve focus.',
    instructions: [
      {
        title: 'Breathe In',
        body: 'Slowly inhale through your nose while counting to four in your head. Feel the air fill your lungs.',
      },
      { title: 'Hold', body: 'Hold your breath for a count of four. Try not to clamp your mouth or nose shut.' },
      { title: 'Breathe Out', body: 'Slowly exhale through your mouth for a count of four. Gently push the air out.' },
      { title: 'Hold', body: 'Hold your breath for a count of four before beginning the cycle again.' },
    ],
  },
  {
    id: 'mindful_reset_video',
    type: 'video',
    category: 'Grounding',
    icon: 'video',
    title: 'Mindful Reset Video',
    subtitle: 'Gentle visual grounding exercise',
    accent: '#5D4FD6',
    card_background: '#E5E3F9',
    duration_minutes: 7,
    difficulty: 'beginner',
    tags: ['Stress'],
    benefit_label: 'Grounding',
    description:
      'A short guided video that walks your senses back to the present moment — useful whenever ' +
      'your thoughts are racing or you feel disconnected from your surroundings.',
    action_label: 'Watch Now',
    action_icon: 'play',
    instructions: [
      { title: 'Settle In', body: 'Find a comfortable spot and press play.' },
      { title: 'Follow Along', body: 'Let the video guide your attention through sight, sound and touch.' },
      { title: 'Notice', body: 'Notice how your body feels once the video ends.' },
    ],
    sequence: [
      { title: 'Mountain Pose Grounding', tag: 'Centering', duration_label: '0:15', icon: 'self_improvement', accent: '#5D4FD6' },
      { title: 'Gentle Side Reach', tag: 'Lateral Release', duration_label: '0:20', icon: 'accessibility_new', accent: '#5B9BE8' },
      { title: 'Standing Rotations (Left)', tag: 'Spine Release', duration_label: '0:20', icon: 'person', accent: '#5D4FD6' },
      { title: 'Standing Rotations (Right)', tag: 'Bilateral Alignment', duration_label: '0:20', icon: 'compare_arrows', accent: '#5B9BE8' },
      { title: 'Ribcage Lateral Expansion', tag: 'Intercostal Breath', duration_label: '0:30', icon: 'height', accent: '#5D4FD6' },
      { title: 'Gentle Torso Unwinding', tag: 'Somatic Reset', duration_label: '0:25', icon: 'accessibility_new', accent: '#1E9D5C' },
      { title: 'Grounded Stillness & Integration', tag: 'Vagal Recovery', duration_label: '0:30', icon: 'spa', accent: '#2F63E0' },
      { title: 'Closing Breath & Release', tag: 'Integration', duration_label: '0:20', icon: 'air', accent: '#1E9D5C' },
    ],
  },
  {
    id: 'midday_desk_mobility',
    type: 'video',
    category: 'Mobility',
    icon: 'fitness',
    title: 'Midday Desk Mobility',
    subtitle: 'Release neck and shoulder tension',
    accent: '#E2932A',
    card_background: '#FCEFCE',
    duration_minutes: 5,
    difficulty: 'beginner',
    tags: ['Stress'],
    benefit_label: 'Tension Relief',
    description:
      'A quick set of seated stretches to release the neck and shoulder tension that builds up ' +
      'during long stretches at a desk.',
    action_label: 'Watch Now',
    action_icon: 'play',
    instructions: [
      { title: 'Roll', body: 'Slowly roll your shoulders back five times.' },
      { title: 'Tilt', body: 'Gently tilt your head toward each shoulder, holding for a few seconds.' },
      { title: 'Reach', body: 'Reach both arms overhead and stretch upward.' },
    ],
    sequence: [
      { title: 'Shoulder Rolls', tag: 'Warm-Up', duration_label: '0:20', icon: 'autorenew', accent: '#E2932A' },
      { title: 'Neck Tilts (Left)', tag: 'Lateral Release', duration_label: '0:20', icon: 'accessibility_new', accent: '#E2932A' },
      { title: 'Neck Tilts (Right)', tag: 'Lateral Release', duration_label: '0:20', icon: 'accessibility_new', accent: '#E2932A' },
      { title: 'Overhead Reach', tag: 'Upper-Body Stretch', duration_label: '0:25', icon: 'height', accent: '#E2932A' },
    ],
  },
  {
    id: 'evening_wind_down',
    type: 'audio',
    category: 'Rest',
    icon: 'night',
    title: 'Evening Wind Down',
    subtitle: 'Prepare your mind for deep, restful sleep',
    accent: '#2F63E0',
    card_background: '#E0ECFB',
    duration_minutes: 10,
    difficulty: 'beginner',
    tags: ['Stress', 'Anxiety'],
    benefit_label: 'Better Sleep',
    description:
      'A calming wind-down routine that eases your mind and body out of the day and toward deep, ' +
      'restful sleep.',
    instructions: [
      { title: 'Dim the Lights', body: 'Lower the lights and put screens away.' },
      { title: 'Breathe Slowly', body: 'Take slow, deep breaths, letting each exhale last longer than the inhale.' },
      { title: 'Rest', body: 'Let your body settle and your mind grow quiet.' },
    ],
  },
];

function withDefaults(e) {
  return {
    action_label: 'Start Now',
    action_icon: 'arrow_forward',
    sequence: [],
    ...e,
  };
}

function summary(e) {
  const { instructions, sequence, ...rest } = withDefaults(e);
  return rest;
}

const list = asyncHandler(async (req, res) => {
  const tag = (req.query.tag || '').trim().toLowerCase();
  const rows = EXERCISES.filter((e) => !tag || e.tags.some((t) => t.toLowerCase() === tag));
  return ok(res, { exercises: rows.map(summary) });
});

const getOne = asyncHandler(async (req, res) => {
  const found = EXERCISES.find((e) => e.id === req.params.id);
  if (!found) return fail(res, 'Exercise not found', 404);
  return ok(res, { exercise: withDefaults(found) });
});

module.exports = { list, getOne };
