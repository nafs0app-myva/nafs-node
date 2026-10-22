const env = require('./env');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Nafs API',
    version: '2.2.0',
    description:
      'REST APIs for the Nafs mobile therapist + client platform. Includes email OTP verification, shared onboarding, role-aware profiles, and dashboard summaries.',
  },
  servers: [{ url: `${env.app.url}/api/v1`, description: 'Local' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': { get: { security: [], summary: 'Health', responses: { 200: { description: 'OK' } } } },
    '/app/bootstrap': { get: { security: [], summary: 'App bootstrap / language', responses: { 200: { description: 'OK' } } } },
    '/auth/login': { post: { security: [], summary: 'Login', responses: { 200: { description: 'OK' } } } },
    '/auth/register': {
      post: {
        security: [],
        summary: 'Register therapist or client (sends email verification OTP)',
        responses: { 201: { description: 'Created' } },
      },
    },
    '/auth/verify-email': {
      post: { security: [], summary: 'Verify email with OTP', responses: { 200: { description: 'OK' } } },
    },
    '/auth/resend-verification': {
      post: { security: [], summary: 'Resend email verification OTP', responses: { 200: { description: 'OK' } } },
    },
    '/auth/forgot-password': {
      post: { security: [], summary: 'Send password-reset OTP email', responses: { 200: { description: 'OK' } } },
    },
    '/auth/me': {
      get: {
        summary: 'Current user + role profile (therapist_profiles or client_profiles) + onboarding',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/onboarding': {
      get: { summary: 'Get onboarding state (client or therapist)', responses: { 200: { description: 'OK' } } },
      put: { summary: 'Save onboarding/setup data (role from JWT)', responses: { 200: { description: 'OK' } } },
    },
    '/profile': {
      get: { summary: 'Get profile for current role', responses: { 200: { description: 'OK' } } },
      patch: { summary: 'Update profile for current role', responses: { 200: { description: 'OK' } } },
    },
    '/application/identity': { put: { summary: 'Therapist application identity step', responses: { 200: { description: 'OK' } } } },
    '/application/submit': { post: { summary: 'Submit therapist application', responses: { 200: { description: 'OK' } } } },
    '/home/dashboard': {
      get: {
        summary: 'Role-aware home dashboard (client or therapist summary)',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions': {
      get: { summary: 'List sessions', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Book session', responses: { 201: { description: 'Created' } } },
    },
    '/clients': {
      get: { summary: 'List clients', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create client', responses: { 201: { description: 'Created' } } },
    },
    '/wallet': { get: { summary: 'Wallet balance', responses: { 200: { description: 'OK' } } } },
    '/payouts': {
      get: { summary: 'List payout requests', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Request payout', responses: { 201: { description: 'Created' } } },
    },
    '/vacations': {
      get: { summary: 'List vacation blocks', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create vacation', responses: { 201: { description: 'Created' } } },
    },
    '/chats': { get: { summary: 'Chat threads', responses: { 200: { description: 'OK' } } } },
    '/mood/checkins': {
      get: { summary: 'List mood check-ins', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create mood check-in', responses: { 201: { description: 'Created' } } },
    },
    '/mood/detector': { post: { summary: 'Save mood detector result', responses: { 201: { description: 'Created' } } } },
    '/journals': {
      get: { summary: 'List journal entries', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create journal entry', responses: { 201: { description: 'Created' } } },
    },
    '/assessments': {
      get: { summary: 'List assessments', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Start assessment', responses: { 201: { description: 'Created' } } },
    },
    '/goals': {
      get: { summary: 'Get user goals', responses: { 200: { description: 'OK' } } },
      put: { summary: 'Save user goals', responses: { 200: { description: 'OK' } } },
    },
    '/specialists': { get: { summary: 'Browse specialists', responses: { 200: { description: 'OK' } } } },
    '/bookings': {
      get: { summary: 'My bookings', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create booking', responses: { 201: { description: 'Created' } } },
    },
    '/bookings/{id}/checkout': { post: { summary: 'Checkout booking', responses: { 200: { description: 'OK' } } } },
    '/devices': {
      get: { summary: 'List devices', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Register device', responses: { 201: { description: 'Created' } } },
    },
    '/notifications/preferences': {
      get: { summary: 'Notification preferences', responses: { 200: { description: 'OK' } } },
      patch: { summary: 'Update notification preferences', responses: { 200: { description: 'OK' } } },
    },
    '/privacy/consents': {
      get: { summary: 'List privacy consents', responses: { 200: { description: 'OK' } } },
      put: { summary: 'Update privacy consents', responses: { 200: { description: 'OK' } } },
    },
    '/privacy/export': { post: { summary: 'Request data export', responses: { 201: { description: 'Created' } } } },
    '/privacy/retention': { get: { summary: 'Retention policy', responses: { 200: { description: 'OK' } } } },
    '/faqs': { get: { security: [], summary: 'FAQ list', responses: { 200: { description: 'OK' } } } },
  },
};
