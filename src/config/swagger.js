const env = require('./env');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Nafs Therapist API',
    version: '2.0.0',
    description:
      'REST APIs for the Nafs mobile therapist platform (application onboarding, dashboard, calendar/sessions, clients, wallet, chat, profile, support). Mapped from Figma Nafs-mobile screens.',
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
    '/auth/login': { post: { security: [], summary: 'Login', responses: { 200: { description: 'OK' } } } },
    '/application/identity': { put: { summary: 'Onboarding identity step', responses: { 200: { description: 'OK' } } } },
    '/application/submit': { post: { summary: 'Submit therapist application', responses: { 200: { description: 'OK' } } } },
    '/home/dashboard': { get: { summary: 'Therapist home', responses: { 200: { description: 'OK' } } } },
    '/sessions': {
      get: { summary: 'List sessions', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Book session', responses: { 201: { description: 'Created' } } },
    },
    '/clients': {
      get: { summary: 'List clients', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create client', responses: { 201: { description: 'Created' } } },
    },
    '/wallet': { get: { summary: 'Wallet balance', responses: { 200: { description: 'OK' } } } },
    '/chats': { get: { summary: 'Chat threads', responses: { 200: { description: 'OK' } } } },
    '/faqs': { get: { security: [], summary: 'FAQ list', responses: { 200: { description: 'OK' } } } },
  },
};
