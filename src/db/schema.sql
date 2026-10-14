SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  gender ENUM('male','female','unspecified') NOT NULL DEFAULT 'unspecified',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  locale VARCHAR(16) NOT NULL DEFAULT 'en',
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_codes (
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

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  bio TEXT NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(120) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  calculation_method VARCHAR(40) NOT NULL DEFAULT 'MWL',
  madhab ENUM('shafi','hanafi') NOT NULL DEFAULT 'shafi',
  goals JSON NULL,
  interests JSON NULL,
  reminder_prefs JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS onboarding_steps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  subtitle VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prayer_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  prayer_name ENUM('fajr','dhuhr','asr','maghrib','isha') NOT NULL,
  prayed_on DATE NOT NULL,
  status ENUM('on_time','late','missed','qada') NOT NULL DEFAULT 'on_time',
  notes VARCHAR(500) NULL,
  logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_prayer_day (user_id, prayer_name, prayed_on),
  CONSTRAINT fk_prayer_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dhikr_presets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  arabic_text VARCHAR(500) NOT NULL,
  transliteration VARCHAR(500) NULL,
  translation VARCHAR(500) NULL,
  target_count INT NOT NULL DEFAULT 33,
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dhikr_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  preset_id INT UNSIGNED NULL,
  title VARCHAR(160) NOT NULL,
  target_count INT NOT NULL,
  current_count INT NOT NULL DEFAULT 0,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  CONSTRAINT fk_dhikr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dhikr_preset FOREIGN KEY (preset_id) REFERENCES dhikr_presets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  mood ENUM('grateful','calm','anxious','sad','hopeful','angry','neutral') NOT NULL DEFAULT 'neutral',
  tags JSON NULL,
  is_private TINYINT(1) NOT NULL DEFAULT 1,
  entry_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_journal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS habits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  icon VARCHAR(64) NULL,
  color VARCHAR(16) NULL,
  frequency ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
  target_per_period INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_habit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS habit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  habit_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  logged_on DATE NOT NULL,
  count INT NOT NULL DEFAULT 1,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_habit_day (habit_id, logged_on),
  CONSTRAINT fk_habit_log_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  CONSTRAINT fk_habit_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  cover_image VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenge_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  challenge_id INT UNSIGNED NOT NULL,
  day_number INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  task_type ENUM('prayer','quran','dhikr','journal','habit','custom') NOT NULL DEFAULT 'custom',
  UNIQUE KEY uq_challenge_day_title (challenge_id, day_number, title),
  CONSTRAINT fk_challenge_task FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_challenges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id INT UNSIGNED NOT NULL,
  started_on DATE NOT NULL,
  current_day INT NOT NULL DEFAULT 1,
  status ENUM('active','completed','abandoned') NOT NULL DEFAULT 'active',
  completed_at DATETIME NULL,
  UNIQUE KEY uq_user_challenge_active (user_id, challenge_id, status),
  CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uc_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_challenge_task_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_challenge_id BIGINT UNSIGNED NOT NULL,
  challenge_task_id INT UNSIGNED NOT NULL,
  completed_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uct (user_challenge_id, challenge_task_id),
  CONSTRAINT fk_uct_uc FOREIGN KEY (user_challenge_id) REFERENCES user_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_uct_task FOREIGN KEY (challenge_task_id) REFERENCES challenge_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quran_progress (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  surah INT NOT NULL,
  ayah INT NOT NULL,
  notes TEXT NULL,
  last_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_quran_user (user_id),
  CONSTRAINT fk_quran_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reflections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  surah INT NULL,
  ayah INT NULL,
  prompt VARCHAR(255) NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reflection_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fasting_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  fast_date DATE NOT NULL,
  fast_type ENUM('ramadan','sunnah','qada','kafarah','other') NOT NULL DEFAULT 'sunnah',
  status ENUM('completed','missed','planned') NOT NULL DEFAULT 'completed',
  notes VARCHAR(500) NULL,
  UNIQUE KEY uq_fast (user_id, fast_date),
  CONSTRAINT fk_fast_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('ayah','dua','hadith','tip','onboarding') NOT NULL,
  title VARCHAR(200) NULL,
  arabic_text TEXT NULL,
  body TEXT NOT NULL,
  source VARCHAR(160) NULL,
  tags JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
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

CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform ENUM('ios','android','web') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_token (token),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
