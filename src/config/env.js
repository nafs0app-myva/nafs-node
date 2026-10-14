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
};

module.exports = env;
