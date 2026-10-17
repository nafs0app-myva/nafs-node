SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_threads;
DROP TABLE IF EXISTS session_notes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS availability_slots;
DROP TABLE IF EXISTS therapist_clients;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS therapist_degrees;
DROP TABLE IF EXISTS therapist_licenses;
DROP TABLE IF EXISTS therapist_specializations;
DROP TABLE IF EXISTS specializations;
DROP TABLE IF EXISTS therapist_applications;
DROP TABLE IF EXISTS therapist_profiles;
DROP TABLE IF EXISTS problem_reports;
DROP TABLE IF EXISTS contact_messages;
DROP TABLE IF EXISTS faqs;
DROP TABLE IF EXISTS policies;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS device_tokens;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  role ENUM('therapist','client','admin') NOT NULL DEFAULT 'therapist',
  locale ENUM('en','ar') NOT NULL DEFAULT 'en',
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE otp_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  email VARCHAR(190) NOT NULL,
  code VARCHAR(10) NOT NULL,
  purpose ENUM('verify_email','reset_password','login') NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_email_purpose (email, purpose),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  identity_number VARCHAR(64) NULL,
  gender ENUM('male','female','unspecified') NOT NULL DEFAULT 'unspecified',
  date_of_birth DATE NULL,
  bio TEXT NULL,
  working_capacity ENUM('individual','team') NOT NULL DEFAULT 'individual',
  years_experience INT NOT NULL DEFAULT 0,
  city VARCHAR(120) NULL,
  country VARCHAR(120) NULL,
  address TEXT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
  video_provider VARCHAR(40) NOT NULL DEFAULT 'custom',
  video_meeting_url VARCHAR(500) NULL,
  admin_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_applications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  status ENUM('draft','submitted','under_review','approved','rejected') NOT NULL DEFAULT 'draft',
  step ENUM('identity','experience','admin_tech','submitted') NOT NULL DEFAULT 'identity',
  identity_payload JSON NULL,
  experience_payload JSON NULL,
  admin_tech_payload JSON NULL,
  submitted_at DATETIME NULL,
  reviewed_at DATETIME NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  review_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE specializations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_specializations (
  therapist_id BIGINT UNSIGNED NOT NULL,
  specialization_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (therapist_id, specialization_id),
  CONSTRAINT fk_ts_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_spec FOREIGN KEY (specialization_id) REFERENCES specializations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_licenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  license_number VARCHAR(120) NOT NULL,
  expiry_date DATE NULL,
  issuer VARCHAR(160) NULL,
  document_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_license_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_degrees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  degree_title VARCHAR(160) NOT NULL,
  institution VARCHAR(160) NOT NULL,
  year_awarded INT NULL,
  document_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_degree_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE therapist_clients (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  client_user_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(32) NULL,
  avatar_url VARCHAR(500) NULL,
  notes TEXT NULL,
  status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  last_session_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tc_therapist (therapist_id),
  CONSTRAINT fk_tc_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_client FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE availability_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL COMMENT '0=Sun .. 6=Sat',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_avail_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NULL,
  session_type ENUM('video','audio','in_person') NOT NULL DEFAULT 'video',
  status ENUM('scheduled','in_progress','completed','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 50,
  fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'SAR',
  join_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_therapist_time (therapist_id, starts_at),
  CONSTRAINT fk_session_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_client FOREIGN KEY (client_id) REFERENCES therapist_clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  therapist_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  is_private TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_note_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'SAR',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallet_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  wallet_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('credit','debit','payout','refund','session_fee') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'SAR',
  status ENUM('pending','completed','failed') NOT NULL DEFAULT 'completed',
  description VARCHAR(255) NULL,
  reference_type VARCHAR(40) NULL,
  reference_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wt_user_time (user_id, created_at),
  CONSTRAINT fk_wt_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
  CONSTRAINT fk_wt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_methods (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  brand VARCHAR(40) NOT NULL,
  last4 VARCHAR(4) NOT NULL,
  exp_month TINYINT UNSIGNED NULL,
  exp_year SMALLINT UNSIGNED NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  provider_token VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_threads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  therapist_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  last_message_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_thread (therapist_id, client_id),
  CONSTRAINT fk_thread_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_thread_client FOREIGN KEY (client_id) REFERENCES therapist_clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  thread_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_thread FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE faqs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_en VARCHAR(255) NOT NULL,
  answer_en TEXT NOT NULL,
  question_ar VARCHAR(255) NULL,
  answer_ar TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE policies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  title_en VARCHAR(160) NOT NULL,
  body_en TEXT NOT NULL,
  title_ar VARCHAR(160) NULL,
  body_ar TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contact_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new','in_progress','closed') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contact_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE problem_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  attachment_url VARCHAR(500) NULL,
  status ENUM('open','resolved','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_problem_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NOT NULL,
  type VARCHAR(64) NOT NULL DEFAULT 'general',
  data JSON NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE device_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform ENUM('ios','android','web') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_token (token),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
