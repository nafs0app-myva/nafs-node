const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

async function runMigrate() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    // Hostinger shared plans often deny CREATE DATABASE; the DB already exists.
    if (err.code !== 'ER_DBACCESS_DENIED_ERROR' && err.code !== 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
      throw err;
    }
  }

  await conn.query(`USE \`${env.db.database}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  await conn.end();

  // Apply additive patches (safe on fresh + existing DBs)
  const { ensureSchema } = require('./ensureSchema');
  await ensureSchema();

  return { database: env.db.database };
}

if (require.main === module) {
  runMigrate()
    .then((r) => {
      console.log(`Migrated database "${r.database}" successfully.`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrate };
