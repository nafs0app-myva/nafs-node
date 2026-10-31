require('dotenv').config();

const env = {
  port: Number(process.env.PORT || 43125),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'nafs',
    password: process.env.DB_PASSWORD || 'nafs_pass',
    database: process.env.DB_NAME || 'nafs',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'nafs_dev_jwt_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  app: {
    name: process.env.APP_NAME || 'Nafs',
    url: process.env.APP_URL || 'http://127.0.0.1:43125',
  },
  setupKey: process.env.SETUP_KEY || '',
  // Push via Firebase Cloud Messaging (HTTP v1). Provide the service-account
  // JSON inline, base64-encoded, or as a file path.
  fcm: {
    serviceAccount: process.env.FCM_SERVICE_ACCOUNT || '',
    serviceAccountFile: process.env.FCM_SERVICE_ACCOUNT_FILE || '',
  },
  // Agora RTC. With both set, /sessions/:id/join issues a token bound to that
  // session's channel; without them it returns no token (app falls back to its test token).
  agora: {
    appId: process.env.AGORA_APP_ID || '',
    appCertificate: process.env.AGORA_APP_CERTIFICATE || '',
  },
  // SMS via Twilio.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM || '',
  },
  // Card payments / refunds through Moyasar. Without a secret key payments are
  // off and checkout just confirms the booking (development mode).
  moyasar: {
    secretKey: process.env.MOYASAR_SECRET_KEY || '',
  },
  // Where contact-us messages and problem reports are emailed.
  supportEmail: process.env.SUPPORT_EMAIL || 'support@nafs.app',
  defaultTimezone: process.env.APP_TIMEZONE || 'Asia/Riyadh',
  smtp: (() => {
    const user = process.env.SMTP_USER || '';
    // Hostinger default when mailbox user is set but host omitted
    const host =
      process.env.SMTP_HOST || (user ? 'smtp.hostinger.com' : '');
    const secureEnv = process.env.SMTP_SECURE;
    const secure =
      secureEnv != null
        ? String(secureEnv) === 'true'
        : host.includes('hostinger.com'); // Hostinger typically uses 465/SSL
    const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
    return {
      host,
      port,
      secure,
      user,
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || (user ? `Nafs <${user}>` : 'Nafs <noreply@nafs.app>'),
    };
  })(),
};

module.exports = env;
