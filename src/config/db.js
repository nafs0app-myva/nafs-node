const mysql = require('mysql2/promise');
const env = require('./env');

// Hostinger MySQL often defaults connections to utf8mb4_general_ci while our
 // schema uses utf8mb4_unicode_ci. Mixing them breaks ENUM/string compares
 // ("Illegal mix of collations"). Force unicode on every connection.
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci',
});

pool.pool.on('connection', (connection) => {
  connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, withTransaction };
