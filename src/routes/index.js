const express = require('express');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const auth = require('../controllers/authController');
const onboarding = require('../controllers/onboardingController');
const home = require('../controllers/homeController');
const prayer = require('../controllers/prayerController');
const dhikr = require('../controllers/dhikrController');
const journal = require('../controllers/journalController');
const habit = require('../controllers/habitController');
const challenge = require('../controllers/challengeController');
const quran = require('../controllers/quranController');
const fasting = require('../controllers/fastingController');
const profile = require('../controllers/profileController');
const content = require('../controllers/contentController');
const notification = require('../controllers/notificationController');

const Joi = require('joi');
const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Nafs API healthy', data: { time: new Date().toISOString() } });
});

// Auth
router.post('/auth/register', validate(auth.registerSchema), auth.register);
router.post('/auth/login', validate(auth.loginSchema), auth.login);
router.post(
  '/auth/verify-email',
  validate(
    Joi.object({ email: Joi.string().email().required(), code: Joi.string().length(6).required() })
  ),
  auth.verifyEmail
);
router.post(
  '/auth/forgot-password',
  validate(Joi.object({ email: Joi.string().email().required() })),
  auth.forgotPassword
);
router.post(
  '/auth/reset-password',
  validate(
    Joi.object({
      email: Joi.string().email().required(),
      code: Joi.string().length(6).required(),
      password: Joi.string().min(8).required(),
    })
  ),
  auth.resetPassword
);
router.get('/auth/me', authenticate, auth.me);

// Onboarding
router.get('/onboarding/steps', onboarding.listSteps);
router.get('/onboarding/status', authenticate, onboarding.status);
router.post(
  '/onboarding/complete',
  authenticate,
  validate(onboarding.completeSchema),
  onboarding.complete
);

// Home
router.get('/home/dashboard', authenticate, home.dashboard);

// Profile
router.get('/profile', authenticate, profile.getProfile);
router.patch('/profile', authenticate, validate(profile.updateSchema), profile.updateProfile);

// Prayers
router.post('/prayers/log', authenticate, validate(prayer.logSchema), prayer.logPrayer);
router.get('/prayers/day', authenticate, prayer.listDay);
router.get('/prayers/calendar', authenticate, prayer.calendar);

// Dhikr
router.get('/dhikr/presets', authenticate, dhikr.listPresets);
router.post('/dhikr/sessions', authenticate, validate(dhikr.startSchema), dhikr.startSession);
router.post(
  '/dhikr/sessions/:id/tick',
  authenticate,
  validate(dhikr.tickSchema),
  dhikr.tick
);
router.get('/dhikr/sessions', authenticate, dhikr.history);

// Journal
router.post('/journals', authenticate, validate(journal.entrySchema), journal.create);
router.get('/journals', authenticate, journal.list);
router.get('/journals/:id', authenticate, journal.getOne);
router.put('/journals/:id', authenticate, validate(journal.entrySchema), journal.update);
router.delete('/journals/:id', authenticate, journal.remove);

// Habits
router.post('/habits', authenticate, validate(habit.habitSchema), habit.create);
router.get('/habits', authenticate, habit.list);
router.post('/habits/:id/log', authenticate, validate(habit.logSchema), habit.log);
router.get('/habits/:id/streak', authenticate, habit.streak);
router.delete('/habits/:id', authenticate, habit.remove);

// Challenges
router.get('/challenges', authenticate, challenge.list);
router.get('/challenges/:id', authenticate, challenge.detail);
router.post('/challenges/:id/join', authenticate, challenge.join);
router.get('/me/challenges', authenticate, challenge.myChallenges);
router.post('/me/challenges/:id/tasks/:taskId/complete', authenticate, challenge.completeTask);

// Qur’an
router.get('/quran/progress', authenticate, quran.getProgress);
router.put('/quran/progress', authenticate, validate(quran.progressSchema), quran.upsertProgress);
router.post(
  '/quran/reflections',
  authenticate,
  validate(quran.reflectionSchema),
  quran.createReflection
);
router.get('/quran/reflections', authenticate, quran.listReflections);

// Fasting
router.post('/fasting/log', authenticate, validate(fasting.logSchema), fasting.upsert);
router.get('/fasting', authenticate, fasting.list);

// Content
router.get('/content', content.list);
router.get('/content/daily', content.daily);

// Notifications
router.get('/notifications', authenticate, notification.list);
router.post('/notifications/:id/read', authenticate, notification.markRead);
router.post('/notifications/read-all', authenticate, notification.markAllRead);
router.post(
  '/devices',
  authenticate,
  validate(notification.deviceSchema),
  notification.registerDevice
);

module.exports = router;
