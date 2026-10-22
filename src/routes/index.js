const express = require('express');
const Joi = require('joi');
const validate = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');

const auth = require('../controllers/authController');
const application = require('../controllers/applicationController');
const dashboard = require('../controllers/dashboardController');
const sessions = require('../controllers/sessionController');
const clients = require('../controllers/clientController');
const wallet = require('../controllers/walletController');
const chat = require('../controllers/chatController');
const support = require('../controllers/supportController');
const profile = require('../controllers/profileController');
const notification = require('../controllers/notificationController');
const appCtrl = require('../controllers/appController');
const mood = require('../controllers/moodController');
const journal = require('../controllers/journalController');
const assessment = require('../controllers/assessmentController');
const booking = require('../controllers/bookingController');
const vacation = require('../controllers/vacationController');
const payout = require('../controllers/payoutController');
const privacy = require('../controllers/privacyController');
const admin = require('../controllers/adminController');
const onboarding = require('../controllers/onboardingController');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Nafs API healthy', data: { time: new Date().toISOString() } });
});

// One-time / secured remote migrate+seed (Hostinger). Requires X-Setup-Key header.
router.post('/admin/db-setup', admin.dbSetup);
router.get('/admin/email-status', admin.emailStatus);
router.post('/admin/email-test', admin.emailTest);

// Splash / language / app config (Figma first pages)
router.get('/app/bootstrap', appCtrl.bootstrap);
router.get('/settings', authenticate, appCtrl.getSettings);
router.patch('/settings', authenticate, validate(appCtrl.settingsSchema), appCtrl.updateSettings);

// Auth
router.post('/auth/register', validate(auth.registerSchema), auth.register);
router.post('/auth/login', validate(auth.loginSchema), auth.login);
router.post(
  '/auth/verify-email',
  validate(Joi.object({ email: Joi.string().email().required(), code: Joi.string().length(6).required() })),
  auth.verifyEmail
);
router.post(
  '/auth/forgot-password',
  validate(Joi.object({ email: Joi.string().email().required() })),
  auth.forgotPassword
);
router.post(
  '/auth/resend-verification',
  validate(auth.resendVerificationSchema),
  auth.resendVerification
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
router.post(
  '/auth/change-password',
  authenticate,
  validate(auth.changePasswordSchema),
  auth.changePassword
);
router.get('/auth/me', authenticate, auth.me);

// Shared onboarding (role from JWT — client + therapist)
router.get('/onboarding', authenticate, onboarding.getOnboarding);
router.put('/onboarding', authenticate, validate(onboarding.saveSchema), onboarding.saveOnboarding);

// Therapist application (detailed licensing flow)
router.get('/specializations', application.listSpecializations);
router.get('/application', authenticate, application.getApplication);
router.get('/application/status', authenticate, application.getStatus);
router.put(
  '/application/identity',
  authenticate,
  validate(application.identitySchema),
  application.saveIdentity
);
router.put(
  '/application/experience',
  authenticate,
  validate(application.experienceSchema),
  application.saveExperience
);
router.put(
  '/application/admin-tech',
  authenticate,
  validate(application.adminTechSchema),
  application.saveAdminTech
);
router.post('/application/submit', authenticate, application.submit);

// Home dashboard
router.get('/home/dashboard', authenticate, dashboard.dashboard);

// Profile
router.get('/profile', authenticate, profile.getProfile);
router.patch('/profile', authenticate, validate(profile.updateSchema), profile.updateProfile);

// Calendar & sessions
router.get('/calendar', authenticate, sessions.calendar);
router.get('/sessions', authenticate, sessions.list);
router.post('/sessions', authenticate, validate(sessions.createSchema), sessions.create);
router.get('/sessions/:id', authenticate, sessions.getOne);
router.patch('/sessions/:id', authenticate, validate(sessions.updateSchema), sessions.update);
router.post('/sessions/:id/join', authenticate, sessions.join);
router.post('/sessions/:id/cancel', authenticate, sessions.cancel);
router.post(
  '/sessions/:id/notes',
  authenticate,
  validate(Joi.object({ body: Joi.string().required(), is_private: Joi.boolean().default(true) })),
  sessions.addNote
);
router.get('/availability', authenticate, sessions.getAvailability);
router.put(
  '/availability',
  authenticate,
  validate(sessions.availabilitySchema),
  sessions.setAvailability
);

// Clients
router.get('/clients', authenticate, clients.list);
router.post('/clients', authenticate, validate(clients.createSchema), clients.create);
router.get('/clients/:id', authenticate, clients.getOne);
router.patch('/clients/:id', authenticate, validate(clients.updateSchema), clients.update);

// Wallet / earnings / billing
router.get('/wallet', authenticate, wallet.getWallet);
router.get('/wallet/transactions', authenticate, wallet.transactions);
router.get('/wallet/overview', authenticate, wallet.overview);
router.post(
  '/wallet/withdraw',
  authenticate,
  validate(Joi.object({ amount: Joi.number().positive().required() })),
  wallet.withdraw
);
router.get('/payment-methods', authenticate, wallet.listPaymentMethods);
router.post(
  '/payment-methods',
  authenticate,
  validate(wallet.paymentMethodSchema),
  wallet.addPaymentMethod
);
router.delete('/payment-methods/:id', authenticate, wallet.deletePaymentMethod);
router.get('/billing-history', authenticate, wallet.billingHistory);

// Chat
router.get('/chats', authenticate, chat.listThreads);
router.post('/chats', authenticate, validate(chat.startSchema), chat.startThread);
router.get('/chats/:id/messages', authenticate, chat.getMessages);
router.post('/chats/:id/messages', authenticate, validate(chat.messageSchema), chat.sendMessage);

// Support / content
router.get('/faqs', support.faqs);
router.get('/policies', support.listPolicies);
router.get('/policies/:slug', support.getPolicy);
router.post('/contact', optionalAuth, validate(support.contactSchema), support.contact);
router.post(
  '/report-problem',
  authenticate,
  validate(support.problemSchema),
  support.reportProblem
);

// Notifications & devices
router.get('/notifications', authenticate, notification.list);
router.post('/notifications/:id/read', authenticate, notification.markRead);
router.post('/notifications/read-all', authenticate, notification.markAllRead);
router.get('/notifications/preferences', authenticate, notification.getPrefs);
router.patch(
  '/notifications/preferences',
  authenticate,
  validate(notification.prefsSchema),
  notification.updatePrefs
);
router.post('/devices', authenticate, validate(notification.deviceSchema), notification.registerDevice);
router.get('/devices', authenticate, notification.listDevices);
router.delete('/devices/:id', authenticate, notification.revokeDevice);

// Client: mood / journal / assessments / goals
router.post('/mood/checkins', authenticate, validate(mood.checkinSchema), mood.createCheckin);
router.get('/mood/checkins', authenticate, mood.listCheckins);
router.post('/mood/detector', authenticate, validate(mood.detectorSchema), mood.saveDetector);
router.post('/journals', authenticate, validate(journal.entrySchema), journal.create);
router.get('/journals', authenticate, journal.list);
router.get('/journals/:id', authenticate, journal.getOne);
router.put('/journals/:id', authenticate, validate(journal.entrySchema), journal.update);
router.delete('/journals/:id', authenticate, journal.remove);
router.post('/assessments', authenticate, validate(assessment.startSchema), assessment.start);
router.post(
  '/assessments/:id/answers',
  authenticate,
  validate(assessment.answerSchema),
  assessment.saveAnswers
);
router.get('/assessments', authenticate, assessment.list);
router.get('/goals', authenticate, assessment.getGoals);
router.put('/goals', authenticate, validate(assessment.goalsSchema), assessment.saveGoals);

// Client: specialists & booking
router.get('/specialists', authenticate, booking.listSpecialists);
router.get('/specialists/:id', authenticate, booking.getSpecialist);
router.post('/bookings', authenticate, validate(booking.createSchema), booking.createBooking);
router.post(
  '/bookings/:id/checkout',
  authenticate,
  validate(Joi.object({ payment_method: Joi.string().allow('', null) })),
  booking.checkout
);
router.get('/bookings', authenticate, booking.myBookings);

// Consultant: vacation & payouts
router.get('/vacations', authenticate, vacation.list);
router.post('/vacations', authenticate, validate(vacation.createSchema), vacation.create);
router.delete('/vacations/:id', authenticate, vacation.remove);
router.get('/payouts', authenticate, payout.list);
router.post('/payouts', authenticate, validate(payout.requestSchema), payout.create);

// Privacy / data
router.get('/privacy/consents', authenticate, privacy.listConsents);
router.put('/privacy/consents', authenticate, validate(privacy.consentsSchema), privacy.updateConsents);
router.get('/privacy/media', authenticate, privacy.listMedia);
router.post('/privacy/media', authenticate, validate(privacy.mediaSchema), privacy.addMedia);
router.delete('/privacy/media/:id', authenticate, privacy.deleteMedia);
router.post('/privacy/export', authenticate, validate(privacy.exportSchema), privacy.requestExport);
router.get('/privacy/exports', authenticate, privacy.listExports);
router.get('/privacy/retention', authenticate, privacy.retentionPolicy);

module.exports = router;
