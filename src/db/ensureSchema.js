const { pool } = require('../config/db');

/**
 * Idempotent schema patches for live deploys (no DROP / data wipe).
 */
async function ensureSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS client_profiles (
        user_id BIGINT UNSIGNED PRIMARY KEY,
        gender ENUM('male','female','unspecified') NOT NULL DEFAULT 'unspecified',
        date_of_birth DATE NULL,
        city VARCHAR(120) NULL,
        country VARCHAR(120) NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
        preferred_language ENUM('en','ar') NOT NULL DEFAULT 'en',
        preferred_therapist_gender ENUM('male','female','any') NOT NULL DEFAULT 'any',
        concerns JSON NULL,
        about TEXT NULL,
        emergency_contact_name VARCHAR(120) NULL,
        emergency_contact_phone VARCHAR(32) NULL,
        onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_onboarding (
        user_id BIGINT UNSIGNED PRIMARY KEY,
        role ENUM('therapist','client') NOT NULL,
        step VARCHAR(64) NOT NULL DEFAULT 'start',
        payload JSON NULL,
        completed TINYINT(1) NOT NULL DEFAULT 0,
        completed_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_onb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS email_outbox (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        to_email VARCHAR(190) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        purpose VARCHAR(64) NULL,
        meta JSON NULL,
        status ENUM('queued','sent','failed','logged') NOT NULL DEFAULT 'logged',
        error_message TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_outbox_to (to_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Backfill client profiles / onboarding rows for existing users
    await conn.query(`
      INSERT IGNORE INTO client_profiles (user_id, preferred_language)
      SELECT id, locale FROM users WHERE role = 'client'
    `);
    await conn.query(`
      INSERT IGNORE INTO user_onboarding (user_id, role)
      SELECT id, role FROM users WHERE role IN ('client','therapist')
    `);
  } finally {
    conn.release();
  }
}

module.exports = { ensureSchema };
