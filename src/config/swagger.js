const env = require('./env');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Nafs Mobile API',
    version: '1.0.0',
    description:
      'REST APIs for the Nafs mobile application (auth, onboarding, prayer, dhikr, journal, habits, challenges, Qur’an, fasting). Refine against the Figma prototype once FIGMA_ACCESS_TOKEN is available.',
  },
  servers: [{ url: `${env.app.url}/api/v1`, description: 'Local' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: { security: [], summary: 'Health check', responses: { 200: { description: 'OK' } } },
    },
    '/auth/register': {
      post: { security: [], summary: 'Register', responses: { 201: { description: 'Created' } } },
    },
    '/auth/login': {
      post: { security: [], summary: 'Login', responses: { 200: { description: 'OK' } } },
    },
    '/auth/me': { get: { summary: 'Current user', responses: { 200: { description: 'OK' } } } },
    '/onboarding/steps': {
      get: {
        security: [],
        summary: 'Onboarding screens',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/onboarding/complete': {
      post: { summary: 'Finish onboarding', responses: { 200: { description: 'OK' } } },
    },
    '/home/dashboard': {
      get: { summary: 'Home dashboard aggregate', responses: { 200: { description: 'OK' } } },
    },
    '/profile': {
      get: { summary: 'Get profile', responses: { 200: { description: 'OK' } } },
      patch: { summary: 'Update profile', responses: { 200: { description: 'OK' } } },
    },
    '/prayers/log': {
      post: { summary: 'Log a prayer', responses: { 201: { description: 'Created' } } },
    },
    '/prayers/day': {
      get: { summary: 'Prayers for a day', responses: { 200: { description: 'OK' } } },
    },
    '/prayers/calendar': {
      get: { summary: 'Monthly prayer calendar', responses: { 200: { description: 'OK' } } },
    },
    '/dhikr/presets': {
      get: { summary: 'Dhikr presets', responses: { 200: { description: 'OK' } } },
    },
    '/dhikr/sessions': {
      post: { summary: 'Start dhikr session', responses: { 201: { description: 'Created' } } },
      get: { summary: 'Dhikr history', responses: { 200: { description: 'OK' } } },
    },
    '/journals': {
      get: { summary: 'List journal entries', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create journal entry', responses: { 201: { description: 'Created' } } },
    },
    '/habits': {
      get: { summary: 'List habits', responses: { 200: { description: 'OK' } } },
      post: { summary: 'Create habit', responses: { 201: { description: 'Created' } } },
    },
    '/challenges': {
      get: { summary: 'List challenges', responses: { 200: { description: 'OK' } } },
    },
    '/quran/progress': {
      get: { summary: 'Get Qur’an progress', responses: { 200: { description: 'OK' } } },
      put: { summary: 'Update Qur’an progress', responses: { 200: { description: 'OK' } } },
    },
    '/fasting/log': {
      post: { summary: 'Log a fast', responses: { 201: { description: 'Created' } } },
    },
    '/content/daily': {
      get: {
        security: [],
        summary: 'Daily ayah/dua/tip',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/notifications': {
      get: { summary: 'List notifications', responses: { 200: { description: 'OK' } } },
    },
  },
};
