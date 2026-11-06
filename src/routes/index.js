const express = require('express');
const Joi = require('joi');
const validate = require('../middleware/validate');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

const auth = require('../controllers/authController');
const application = require('../controllers/applicationController');
const dashboard = require('../controllers/dashboardController');
const sessions = require('../controllers/sessionController');
const calls = require('../controllers/callController');
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
const credentials = require('../controllers/credentialController');
const privacy = require('../controllers/privacyController');
const admin = require('../controllers/adminController');
const adminPanel = require('../controllers/adminPanelController');
const onboarding = require('../controllers/onboardingController');
const exercises = require('../controllers/exerciseController');
const payments = require('../controllers/paymentController');

const rateLimit = require('express-rate-limit');

// Guessing the current password with a stolen session: 5 attempts per 15 minutes per user.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `pw:${req.user?.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many attempts. Try again in 15 minutes.', errors: null }),
});

const router = express.Router();

router.get('/health', (_req, res) => {
  const { pushConfigured } = require('../services/pushService');
  res.json({
    success: true,
    message: 'Nafs API healthy',
    data: { time: new Date().toISOString(), push_configured: pushConfigured() },
  });
});

// One-time / secured remote migrate+seed (Hostinger). Requires X-Setup-Key header.
router.post('/admin/db-setup', admin.dbSetup);
router.get('/admin/email-status', admin.emailStatus);
router.post('/admin/email-test', admin.emailTest);
router.get('/admin/push-status', admin.pushStatusAdmin);
router.post('/admin/push-config', admin.pushConfigAdmin);
router.get('/admin/agora-status', admin.agoraStatusAdmin);
router.post('/admin/agora-config', admin.agoraConfigAdmin);
router.get('/admin/stripe-status', admin.stripeStatusAdmin);
router.post('/admin/stripe-config', admin.stripeConfigAdmin);

// JWT admin panel (role=admin) — used by https://myva.ae/admin/
router.get('/admin/panel/overview', authenticate, requireRole('admin'), adminPanel.overview);
router.get('/admin/panel/activity', authenticate, requireRole('admin'), adminPanel.activity);
router.get('/admin/panel/users', authenticate, requireRole('admin'), adminPanel.listUsers);
router.post(
  '/admin/panel/users',
  authenticate,
  requireRole('admin'),
  validate(adminPanel.createUserSchema),
  adminPanel.createUser
);
router.patch(
  '/admin/panel/users/:id',
  authenticate,
  requireRole('admin'),
  validate(adminPanel.updateUserSchema),
  adminPanel.updateUser
);
router.delete('/admin/panel/users/:id', authenticate, requireRole('admin'), adminPanel.removeUser);
router.post(
  '/admin/panel/consultants',
  authenticate,
  requireRole('admin'),
  validate(adminPanel.createConsultantSchema),
  adminPanel.createConsultant
);
router.get('/admin/panel/applications', authenticate, requireRole('admin'), adminPanel.listApplications);
router.post(
  '/admin/panel/applications/:id/approve',
  authenticate,
  requireRole('admin'),
  validate(adminPanel.reviewSchema),
  adminPanel.approveApplication
);
router.post(
  '/admin/panel/applications/:id/reject',
  authenticate,
  requireRole('admin'),
  validate(adminPanel.reviewSchema),
  adminPanel.rejectApplication
);

// Splash / language / app config (Figma first pages)
router.get('/app/bootstrap', appCtrl.bootstrap);
router.get('/settings', authenticate, appCtrl.getSettings);
router.patch('/settings', authenticate, validate(appCtrl.settingsSchema), appCtrl.updateSettings);

// Auth
router.post('/auth/register', validate(auth.registerSchema), auth.register);
// Failed sign-ins only: 8 per 15 minutes per account + IP, so a password can't be brute-forced.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${String(req.body?.email || req.body?.phone || '').toLowerCase()}:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many failed sign-in attempts. Try again in 15 minutes.', errors: null }),
});
router.post('/auth/login', loginLimiter, validate(auth.loginSchema), auth.login);
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
      password: auth.strongPassword.required(),
    })
  ),
  auth.resetPassword
);
router.post(
  '/auth/change-password',
  authenticate,
  changePasswordLimiter,
  validate(auth.changePasswordSchema),
  auth.changePassword
);
router.post('/auth/logout', authenticate, validate(auth.logoutSchema), auth.logout);
router.post('/auth/logout-all', authenticate, auth.logoutAll);
router.get('/auth/me', authenticate, auth.me);

// Shared onboarding (role from JWT — client + therapist)
router.get('/onboarding', authenticate, onboarding.getOnboarding);
router.put('/onboarding', authenticate, validate(onboarding.saveSchema), onboarding.saveOnboarding);

// Therapist application (detailed licensing flow)
router.get('/specializations', application.listSpecializations);
router.get('/modalities', application.listModalities);
router.get('/practice-scope/options', application.practiceScopeOptions);
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
router.post('/profile/avatar', authenticate, profile.uploadAvatar);
router.get('/profile/avatar/:userId', profile.getAvatar);
router.post('/credentials/:type/:id/document', authenticate, requireRole('therapist'), credentials.uploadDocument);
router.get('/credentials/:type/:id/document', authenticate, requireRole('therapist'), credentials.getOwnDocument);
router.delete('/credentials/:type/:id/document', authenticate, requireRole('therapist'), credentials.removeDocument);
router.get('/credentials/documents/:docId', authenticate, credentials.getDocument);

// Calendar & sessions
router.get('/calendar', authenticate, sessions.calendar);
router.get('/sessions', authenticate, sessions.list);
router.post('/sessions', authenticate, validate(sessions.createSchema), sessions.create);
router.get('/sessions/:id', authenticate, sessions.getOne);
router.patch('/sessions/:id', authenticate, validate(sessions.updateSchema), sessions.update);
router.post('/sessions/:id/join', authenticate, sessions.join);
router.post('/sessions/:id/call/ring', authenticate, calls.ring);
router.get('/calls/:id', authenticate, calls.status);
router.post('/calls/:id/accept', authenticate, calls.accept);
router.post('/calls/:id/decline', authenticate, calls.decline);
router.post('/calls/:id/cancel', authenticate, validate(calls.cancelSchema), calls.cancel);
router.post('/sessions/:id/review', authenticate, validate(sessions.reviewSchema), sessions.review);
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
router.get('/fees/terms', wallet.feeTerms);
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
router.patch(
  '/payment-methods/:id',
  authenticate,
  validate(wallet.paymentMethodUpdateSchema),
  wallet.updatePaymentMethod
);
router.delete('/payment-methods/:id', authenticate, wallet.deletePaymentMethod);
router.get('/billing-history', authenticate, wallet.billingHistory);

// Payments (Figma Checkout / Payment Methods / Billing)
router.get('/payments/options', authenticate, payments.paymentOptions);
router.get('/payments/return', payments.paymentReturn);
router.post('/payments/webhook', payments.moyasarWebhook);
router.post('/payments/stripe/webhook', payments.stripeWebhook);
router.get('/payments/:bookingId/status', authenticate, payments.paymentStatus);

// Chat
router.get('/chats', authenticate, chat.listThreads);
router.post('/chats', authenticate, validate(chat.startSchema), chat.startThread);
router.get('/chats/:id/messages', authenticate, chat.getMessages);
router.post('/chats/:id/messages', authenticate, validate(chat.messageSchema), chat.sendMessage);

// Support / content
router.get('/faqs', support.faqs);
router.get('/policies', support.listPolicies);
router.get('/policies/:slug', support.getPolicy);
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many messages. Please try again later.', errors: null }),
});
router.post('/contact', optionalAuth, contactLimiter, validate(support.contactSchema), support.contact);
router.get('/contact/messages', authenticate, support.myMessages);
router.patch('/contact/:id', authenticate, requireRole('admin'), validate(support.replySchema), support.replyToMessage);
const problemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `pr:${req.user?.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many reports. Please try again later.', errors: null }),
});
router.get('/report-problem/categories', support.categories);
router.get('/report-problem', authenticate, support.myProblems);
router.post('/report-problem', authenticate, problemLimiter, validate(support.problemSchema), support.reportProblem);
router.post('/report-problem/:id/screenshot', authenticate, support.uploadScreenshot);
router.get('/report-problem/:id/screenshot', authenticate, support.getScreenshot);
router.patch('/report-problem/:id', authenticate, requireRole('admin'), validate(support.problemUpdateSchema), support.updateProblem);

// Notifications & devices
router.get('/notifications', authenticate, notification.list);
router.post(
  '/notifications/test-push',
  authenticate,
  validate(notification.testPushSchema),
  notification.testPush
);
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
router.delete('/devices', authenticate, notification.revokeOtherDevices);
router.delete('/devices/:id', authenticate, notification.revokeDevice);

// Client: mood / journal / assessments / goals
router.post('/mood/checkins', authenticate, validate(mood.checkinSchema), mood.createCheckin);
router.get('/mood/checkins', authenticate, mood.listCheckins);
router.post('/mood/detector', authenticate, validate(mood.detectorSchema), mood.saveDetector);
router.post('/journals', authenticate, validate(journal.entrySchema), journal.create);
router.get('/journals', authenticate, journal.list);
// Must be registered before /journals/:id so "prompt" is not treated as an id.
router.get('/journals/prompt', authenticate, journal.getPrompt);
router.get('/journals/:id', authenticate, journal.getOne);
router.put('/journals/:id', authenticate, validate(journal.entrySchema), journal.update);
router.delete('/journals/:id', authenticate, journal.remove);
// Admin: manage rotating journal prompt pool
router.get('/journal-prompts', authenticate, requireRole('admin'), journal.listPromptsAdmin);
router.post(
  '/journal-prompts',
  authenticate,
  requireRole('admin'),
  validate(journal.promptAdminSchema),
  journal.createPromptAdmin
);
router.patch(
  '/journal-prompts/:id',
  authenticate,
  requireRole('admin'),
  validate(journal.promptAdminUpdateSchema),
  journal.updatePromptAdmin
);
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

// Client: exercise library (read-only catalogue) + per-user My Plan
router.get('/exercises', authenticate, exercises.list);
router.get('/exercises/:id', authenticate, exercises.getOne);
router.get('/plan/exercises', authenticate, exercises.listPlan);
router.post(
  '/plan/exercises',
  authenticate,
  validate(exercises.addToPlanSchema),
  exercises.addToPlan
);
router.delete('/plan/exercises/:exercise_id', authenticate, exercises.removeFromPlan);
router.post(
  '/plan/exercises/:exercise_id/complete',
  authenticate,
  exercises.completePlanExercise
);

// Client: specialists & booking
router.get('/specialists', authenticate, booking.listSpecialists);
router.get('/specialists/:id/availability', authenticate, booking.getSpecialistAvailability);
router.get('/specialists/:id', authenticate, booking.getSpecialist);
router.post('/bookings', authenticate, validate(booking.createSchema), booking.createBooking);
router.get('/bookings/:id/checkout-summary', authenticate, payments.checkoutSummary);
router.post(
  '/bookings/:id/checkout',
  authenticate,
  validate(Joi.object({ payment_method: Joi.string().allow('', null) })),
  booking.checkout
);
router.get('/bookings', authenticate, booking.myBookings);
router.get('/bookings/:id/cancel-preview', authenticate, booking.cancelPreview);
router.post('/bookings/:id/pay', authenticate, validate(payments.paySchema), payments.startPayment);
router.post('/bookings/:id/cancel', authenticate, booking.cancelBooking);

// Consultant: vacation & payouts
router.get('/vacations', authenticate, vacation.list);
router.post('/vacations', authenticate, validate(vacation.createSchema), vacation.create);
router.patch('/vacations/:id', authenticate, validate(vacation.updateSchema), vacation.update);
router.delete('/vacations/:id', authenticate, vacation.remove);
router.get('/payouts', authenticate, payout.list);
router.post('/payouts', authenticate, validate(payout.requestSchema), payout.create);
router.patch(
  '/payouts/:id/status',
  authenticate,
  requireRole('admin'),
  validate(payout.statusSchema),
  payout.updateStatus
);

// Privacy / data
router.get('/privacy/consents', authenticate, privacy.listConsents);
router.put('/privacy/consents', authenticate, validate(privacy.consentsSchema), privacy.updateConsents);
router.get('/privacy/media', authenticate, privacy.listMedia);
router.post('/privacy/media', authenticate, validate(privacy.mediaSchema), privacy.addMedia);
router.post('/privacy/media/upload', authenticate, privacy.uploadMedia);
router.get('/privacy/media/:id/file', authenticate, privacy.getMediaFile);
router.delete('/privacy/media/:id', authenticate, privacy.deleteMedia);
router.post('/privacy/export', authenticate, validate(privacy.exportSchema), privacy.requestExport);
router.get('/privacy/exports', authenticate, privacy.listExports);
router.get('/privacy/exports/:id/download', authenticate, privacy.downloadExport);
router.get('/privacy/retention', authenticate, privacy.retentionPolicy);

module.exports = router;
