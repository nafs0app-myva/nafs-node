const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');

async function start() {
  // Fail fast if DB is unreachable
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`Nafs API listening on http://127.0.0.1:${env.port}`);
    console.log(`API docs: http://127.0.0.1:${env.port}/api/docs`);
    console.log(`Explorer: http://127.0.0.1:${env.port}/`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
