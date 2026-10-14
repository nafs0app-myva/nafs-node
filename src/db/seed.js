const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/db');

async function seed() {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  await query(
    `INSERT INTO users (email, phone, password_hash, full_name, gender, timezone, locale, is_verified, onboarding_completed)
     VALUES (:email, :phone, :password_hash, :full_name, :gender, :timezone, :locale, 1, 1)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    {
      email: 'demo@nafs.app',
      phone: '+10000000000',
      password_hash: passwordHash,
      full_name: 'Demo User',
      gender: 'unspecified',
      timezone: 'Asia/Karachi',
      locale: 'en',
    }
  );

  const users = await query(`SELECT id FROM users WHERE email = :email`, { email: 'demo@nafs.app' });
  const userId = users[0].id;

  await query(
    `INSERT INTO user_profiles (user_id, bio, city, country, calculation_method, madhab, goals, interests, reminder_prefs)
     VALUES (:user_id, :bio, :city, :country, 'MWL', 'hanafi', :goals, :interests, :reminder_prefs)
     ON DUPLICATE KEY UPDATE bio = VALUES(bio)`,
    {
      user_id: userId,
      bio: 'Building better habits, one prayer at a time.',
      city: 'Lahore',
      country: 'Pakistan',
      goals: JSON.stringify(['pray_on_time', 'daily_quran', 'dhikr']),
      interests: JSON.stringify(['quran', 'prayer', 'journal']),
      reminder_prefs: JSON.stringify({ prayer: true, dhikr: true, journal: false }),
    }
  );

  const onboarding = [
    ['welcome', 'Welcome to Nafs', 'Nurture your soul with intentional daily worship.', 1],
    ['prayer', 'Guard your prayers', 'Track salah, build streaks, and stay consistent.', 2],
    ['dhikr', 'Remember often', 'Guided dhikr counters for calm and focus.', 3],
    ['reflect', 'Reflect & grow', 'Journal moods, gratitude, and Qur’anic reflections.', 4],
  ];
  for (const [slug, title, subtitle, sort] of onboarding) {
    await query(
      `INSERT INTO onboarding_steps (slug, title, subtitle, sort_order)
       VALUES (:slug, :title, :subtitle, :sort)
       ON DUPLICATE KEY UPDATE title = VALUES(title), subtitle = VALUES(subtitle)`,
      { slug, title, subtitle, sort }
    );
  }

  const presets = [
    ['SubhanAllah', 'سُبْحَانَ ٱللَّٰهِ', 'SubhanAllah', 'Glory be to Allah', 33, 'tasbih'],
    ['Alhamdulillah', 'ٱلْحَمْدُ لِلَّٰهِ', 'Alhamdulillah', 'All praise is for Allah', 33, 'tasbih'],
    ['Allahu Akbar', 'ٱللَّٰهُ أَكْبَرُ', 'Allahu Akbar', 'Allah is the Greatest', 34, 'tasbih'],
    ['Astaghfirullah', 'أَسْتَغْفِرُ ٱللَّٰهَ', 'Astaghfirullah', 'I seek forgiveness from Allah', 100, 'istighfar'],
  ];
  for (const [title, arabic, transliteration, translation, target, category] of presets) {
    const existing = await query(`SELECT id FROM dhikr_presets WHERE title = :title`, { title });
    if (!existing.length) {
      await query(
        `INSERT INTO dhikr_presets (title, arabic_text, transliteration, translation, target_count, category)
         VALUES (:title, :arabic, :transliteration, :translation, :target, :category)`,
        { title, arabic, transliteration, translation, target, category }
      );
    }
  }

  await query(
    `INSERT INTO challenges (slug, title, description, duration_days)
     VALUES ('30-day-discipline', '30-Day Discipline', 'Daily prayer, Qur’an, and dhikr for 30 days.', 30)
     ON DUPLICATE KEY UPDATE title = VALUES(title)`
  );
  const challenges = await query(`SELECT id FROM challenges WHERE slug = '30-day-discipline'`);
  const challengeId = challenges[0].id;

  for (let day = 1; day <= 7; day += 1) {
    const tasks = [
      [`Pray all 5 salah`, 'Log Fajr through Isha', 'prayer'],
      [`Read Qur’an`, 'Read at least one page and reflect', 'quran'],
      [`Evening dhikr`, 'Complete a dhikr session', 'dhikr'],
    ];
    for (const [title, description, task_type] of tasks) {
      await query(
        `INSERT IGNORE INTO challenge_tasks (challenge_id, day_number, title, description, task_type)
         VALUES (:challenge_id, :day_number, :title, :description, :task_type)`,
        { challenge_id: challengeId, day_number: day, title, description, task_type }
      );
    }
  }

  const content = [
    ['ayah', 'Patience', 'إِنَّ اللَّهَ مَعَ الصَّابِرِينَ', 'Indeed, Allah is with the patient.', 'Qur’an 2:153'],
    ['dua', 'Morning protection', null, 'O Allah, I ask You for beneficial knowledge, good provision, and accepted deeds.', 'Prophetic dua'],
    ['tip', 'Start small', null, 'Consistency beats intensity. One sincere rakah on time shapes the day.', 'Nafs tip'],
  ];
  for (const [kind, title, arabic_text, body, source] of content) {
    const existing = await query(`SELECT id FROM content_items WHERE kind = :kind AND title = :title`, {
      kind,
      title,
    });
    if (!existing.length) {
      await query(
        `INSERT INTO content_items (kind, title, arabic_text, body, source, tags)
         VALUES (:kind, :title, :arabic_text, :body, :source, :tags)`,
        {
          kind,
          title,
          arabic_text,
          body,
          source,
          tags: JSON.stringify([kind]),
        }
      );
    }
  }

  const habits = await query(`SELECT id FROM habits WHERE user_id = :user_id`, { user_id: userId });
  if (!habits.length) {
    await query(
      `INSERT INTO habits (user_id, title, description, icon, color, frequency)
       VALUES
       (:user_id, 'Fajr on time', 'Wake for Fajr without snooze', 'sunrise', '#0F766E', 'daily'),
       (:user_id, 'Qur’an page', 'Read at least one page', 'book', '#1D4ED8', 'daily'),
       (:user_id, 'Evening dhikr', 'Complete tasbih after Maghrib', 'beads', '#B45309', 'daily')`,
      { user_id: userId }
    );
  }

  console.log('Seed complete. Demo login: demo@nafs.app / Password123!');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
