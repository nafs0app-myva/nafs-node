const { pool } = require('../config/db');

/**
 * Idempotent schema patches for live deploys (no DROP / data wipe).
 */
async function ensureSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Hostinger DBs often default to utf8mb4_general_ci while schema.sql uses
    // utf8mb4_unicode_ci. Align live tables so ENUM/string compares succeed.
    for (const table of ['faqs', 'policies', 'sessions', 'vacation_blocks']) {
      try {
        await conn.query(
          `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
      } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

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

    // Default session fee for therapist Admin screen
    try {
      await conn.query(`
        ALTER TABLE therapist_profiles
        ADD COLUMN session_fee_default DECIMAL(12,2) NULL AFTER video_meeting_url
      `);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Therapist practice scope (age groups / session formats / modalities) as JSON
    try {
      await conn.query(`
        ALTER TABLE therapist_profiles
        ADD COLUMN practice_scope JSON NULL AFTER session_fee_default
      `);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Therapist headline (short tagline) + therapeutic frameworks
    try {
      await conn.query(`
        ALTER TABLE therapist_profiles
        ADD COLUMN headline VARCHAR(120) NULL
      `);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
    try {
      await conn.query(`
        ALTER TABLE therapist_profiles
        ADD COLUMN frameworks JSON NULL
      `);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // FAQ category + audience (therapist / client)
    try {
      await conn.query(`ALTER TABLE faqs ADD COLUMN category VARCHAR(40) NULL AFTER answer_ar`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    try {
      await conn.query(
        `ALTER TABLE faqs ADD COLUMN audience ENUM('all','therapist','client') NOT NULL DEFAULT 'all' AFTER category`
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS session_reviews (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        session_id BIGINT UNSIGNED NOT NULL UNIQUE,
        therapist_id BIGINT UNSIGNED NOT NULL,
        client_user_id BIGINT UNSIGNED NOT NULL,
        rating TINYINT UNSIGNED NOT NULL,
        comment VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_review_therapist (therapist_id),
        CONSTRAINT fk_review_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_review_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_review_client FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        expires_at DATETIME NOT NULL,
        INDEX idx_revoked_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS session_calls (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        session_id BIGINT UNSIGNED NOT NULL,
        caller_id BIGINT UNSIGNED NOT NULL,
        callee_id BIGINT UNSIGNED NOT NULL,
        status ENUM('ringing','accepted','declined','missed','cancelled') NOT NULL DEFAULT 'ringing',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        answered_at DATETIME NULL,
        INDEX idx_call_session (session_id, status),
        INDEX idx_call_callee (callee_id, status),
        CONSTRAINT fk_call_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_call_caller FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_call_callee FOREIGN KEY (callee_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS credential_documents (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        therapist_id BIGINT UNSIGNED NOT NULL,
        owner_type ENUM('license','degree') NOT NULL,
        owner_id BIGINT UNSIGNED NOT NULL,
        filename VARCHAR(190) NOT NULL,
        mime VARCHAR(60) NOT NULL,
        data MEDIUMBLOB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cred_doc_owner (owner_type, owner_id),
        CONSTRAINT fk_cred_doc_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_avatars (
        user_id BIGINT UNSIGNED PRIMARY KEY,
        mime VARCHAR(40) NOT NULL,
        data MEDIUMBLOB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_avatar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try {
      await conn.query(`ALTER TABLE therapist_degrees ADD COLUMN certifies_age_group VARCHAR(20) NULL AFTER year_awarded`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    try {
      await conn.query(`ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Specialization icons + the therapeutic modalities catalogue
    try {
      await conn.query(`ALTER TABLE specializations ADD COLUMN icon VARCHAR(40) NULL AFTER name_ar`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
    await conn.query(`
      CREATE TABLE IF NOT EXISTS modalities (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(40) NOT NULL UNIQUE,
        name_en VARCHAR(120) NOT NULL,
        name_ar VARCHAR(120) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      INSERT IGNORE INTO modalities (slug, name_en, name_ar, sort_order) VALUES
        ('cbt', 'Cognitive Behavioral (CBT)', 'العلاج المعرفي السلوكي', 1),
        ('emdr', 'EMDR Therapy', 'العلاج بإزالة التحسس وإعادة المعالجة', 2),
        ('act', 'Acceptance & Commitment (ACT)', 'العلاج بالقبول والالتزام', 3),
        ('psychodynamic', 'Psychodynamic Therapy', 'العلاج الديناميكي النفسي', 4),
        ('mbct', 'Mindfulness-Based (MBCT)', 'العلاج المعرفي القائم على اليقظة', 5),
        ('dbt', 'Dialectical Behavior (DBT)', 'العلاج الجدلي السلوكي', 6),
        ('sfbt', 'Solution-Focused (SFBT)', 'العلاج الموجه نحو الحلول', 7),
        ('cft', 'Compassion-Focused (CFT)', 'العلاج المرتكز على التعاطف', 8)
    `);
    await conn.query(`
      UPDATE specializations SET icon = CASE slug
        WHEN 'anxiety' THEN 'anxiety' WHEN 'trauma' THEN 'trauma' WHEN 'marriage' THEN 'heart'
        WHEN 'child' THEN 'child' WHEN 'clinical' THEN 'clinical' ELSE icon END
      WHERE icon IS NULL
    `);

    try {
      await conn.query(`ALTER TABLE therapist_profiles ADD COLUMN session_duration_minutes INT NOT NULL DEFAULT 50`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    for (const [col, def] of [['bank_name', 'VARCHAR(120)'], ['bank_account_holder', 'VARCHAR(120)'], ['iban', 'VARCHAR(40)']]) {
      try {
        await conn.query(`ALTER TABLE therapist_profiles ADD COLUMN ${col} ${def} NULL`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }

    // Therapist languages (native + other spoken)
    try {
      await conn.query(`ALTER TABLE therapist_profiles ADD COLUMN native_language VARCHAR(40) NULL`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
    try {
      await conn.query(`ALTER TABLE therapist_profiles ADD COLUMN languages JSON NULL`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }

    // Remember which sessions / bookings a vacation block cancelled so deleting
    // the block can restore them.
    for (const table of ['sessions', 'bookings']) {
      try {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN cancelled_by_vacation_id BIGINT UNSIGNED NULL`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

    // The payout FAQ used to say "weekly"; payouts are on request (3-5 business days).
    await conn.query(
      `UPDATE faqs SET answer_en = 'Session earnings are added to your wallet after completed sessions. Request a payout from the Earnings tab; requests are reviewed within 3-5 business days.'
       WHERE question_en = 'When do I get paid?' AND answer_en LIKE '%weekly%'`
    ).catch(() => {});

    for (const col of ['start_time', 'end_time']) {
      try {
        await conn.query(`ALTER TABLE vacation_blocks ADD COLUMN ${col} TIME NULL`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

    try {
      await conn.query(`ALTER TABLE bookings ADD COLUMN payment_invoice_id VARCHAR(64) NULL`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
    try {
      await conn.query(`ALTER TABLE bookings ADD COLUMN payment_id VARCHAR(64) NULL, ADD UNIQUE KEY uq_booking_payment (payment_id)`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
    // Figma Checkout price summary: session fee + client service fee = total.
    for (const [col, def] of [
      ['service_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
      ['total_amount', 'DECIMAL(12,2) NULL'],
    ]) {
      try {
        await conn.query(`ALTER TABLE bookings ADD COLUMN ${col} ${def}`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }
    try {
      await conn.query(
        `ALTER TABLE payment_methods ADD COLUMN method_type ENUM('card','apple_pay','google_pay') NOT NULL DEFAULT 'card' AFTER brand`
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    for (const [col, def] of [['reply', 'TEXT'], ['replied_at', 'TIMESTAMP']]) {
      try {
        await conn.query(`ALTER TABLE contact_messages ADD COLUMN ${col} ${def} NULL`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

    for (const [col, def] of [
      ['device_info', 'JSON'], ['screenshot_mime', 'VARCHAR(40)'], ['screenshot', 'MEDIUMBLOB'],
      ['resolution', 'TEXT'], ['resolved_at', 'TIMESTAMP'],
    ]) {
      try {
        await conn.query(`ALTER TABLE problem_reports ADD COLUMN ${col} ${def} NULL`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

    // Policy audience + ordering
    try {
      await conn.query(
        `ALTER TABLE policies ADD COLUMN audience ENUM('all','therapist','client') NOT NULL DEFAULT 'all' AFTER body_ar`
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    try {
      await conn.query(`ALTER TABLE policies ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER audience`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    // Privacy: stored export files and uploaded recording files
    for (const stmt of [
      `ALTER TABLE data_export_requests ADD COLUMN file_name VARCHAR(190) NULL`,
      `ALTER TABLE data_export_requests ADD COLUMN file_mime VARCHAR(80) NULL`,
      `ALTER TABLE data_export_requests ADD COLUMN file_data LONGBLOB NULL`,
      `ALTER TABLE device_tokens ADD COLUMN session_hash CHAR(64) NULL`,
      `ALTER TABLE device_tokens ADD COLUMN session_expires_at DATETIME NULL`,
      `ALTER TABLE media_recordings ADD COLUMN file_mime VARCHAR(80) NULL`,
      `ALTER TABLE media_recordings ADD COLUMN file_data LONGBLOB NULL`,
    ]) {
      try {
        await conn.query(stmt);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
      }
    }

    // Journal prompts (rotate-once-answered pool managed from backend)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS journal_prompts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        text_en VARCHAR(500) NOT NULL,
        text_ar VARCHAR(500) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_journal_prompts_active_sort (is_active, sort_order, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await conn.query(
        `ALTER TABLE journal_entries ADD COLUMN prompt_id BIGINT UNSIGNED NULL AFTER user_id`
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    try {
      await conn.query(
        `ALTER TABLE journal_entries ADD INDEX idx_journal_user_prompt (user_id, prompt_id)`
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    try {
      await conn.query(
        `ALTER TABLE journal_entries
         ADD CONSTRAINT fk_journal_prompt FOREIGN KEY (prompt_id) REFERENCES journal_prompts(id) ON DELETE SET NULL`
      );
    } catch (err) {
      // Already exists / table missing / engine quirks on shared hosts
      if (
        err.code !== 'ER_DUP_KEYNAME' &&
        err.code !== 'ER_FK_DUP_NAME' &&
        err.code !== 'ER_CANNOT_ADD_FOREIGN' &&
        err.code !== 'ER_NO_REFERENCED_ROW_2' &&
        err.code !== 'ER_NO_SUCH_TABLE' &&
        err.errno !== 1826
      ) {
        // MySQL 1050/1005 variants — ignore if constraint already present
        if (!String(err.message || '').match(/Duplicate|already exists|errno: 121/i)) throw err;
      }
    }

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
