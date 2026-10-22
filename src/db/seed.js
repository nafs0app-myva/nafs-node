const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/db');

async function runSeed() {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  await query(
    `INSERT INTO users (email, phone, password_hash, full_name, role, locale, is_verified)
     VALUES (:email, :phone, :password_hash, :full_name, 'therapist', 'en', 1)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = 'therapist'`,
    {
      email: 'demo@nafs.app',
      phone: '+966500000000',
      password_hash: passwordHash,
      full_name: 'Dr. Sara Alami',
    }
  );

  const users = await query(`SELECT id FROM users WHERE email = :email`, { email: 'demo@nafs.app' });
  const therapistId = users[0].id;

  await query(
    `INSERT INTO therapist_profiles
      (user_id, identity_number, gender, date_of_birth, bio, working_capacity, years_experience, city, country, address)
     VALUES
      (:user_id, 'ID-998877', 'female', '1988-04-12',
       'Licensed clinical psychologist specializing in anxiety, couples, and trauma-informed care.',
       'individual', 12, 'Riyadh', 'Saudi Arabia', 'Olaya District')
     ON DUPLICATE KEY UPDATE bio = VALUES(bio), years_experience = VALUES(years_experience)`,
    { user_id: therapistId }
  );

  await query(
    `INSERT INTO therapist_applications
      (user_id, status, step, submitted_at, reviewed_at, identity_payload, experience_payload, admin_tech_payload)
     VALUES
      (:user_id, 'approved', 'submitted', NOW(), NOW(), :identity, :experience, :admin_tech)
     ON DUPLICATE KEY UPDATE status = 'approved', step = 'submitted'`,
    {
      user_id: therapistId,
      identity: JSON.stringify({ full_name: 'Dr. Sara Alami', identity_number: 'ID-998877' }),
      experience: JSON.stringify({ years_experience: 12, specializations: ['clinical', 'marriage'] }),
      admin_tech: JSON.stringify({ city: 'Riyadh', video_provider: 'custom' }),
    }
  );

  const specs = [
    ['clinical', 'Clinical Psychologist', 'أخصائي نفسي إكلينيكي'],
    ['marriage', 'Marriage Counseling', 'إرشاد زوجي'],
    ['anxiety', 'Anxiety & Stress', 'القلق والتوتر'],
    ['trauma', 'Trauma Therapy', 'علاج الصدمات'],
    ['child', 'Child & Adolescent', 'الأطفال والمراهقون'],
  ];
  for (const [slug, name_en, name_ar] of specs) {
    await query(
      `INSERT INTO specializations (slug, name_en, name_ar)
       VALUES (:slug, :name_en, :name_ar)
       ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_ar = VALUES(name_ar)`,
      { slug, name_en, name_ar }
    );
  }

  const allSpecs = await query(`SELECT id FROM specializations WHERE is_active = 1`);
  for (const s of allSpecs.slice(0, 3)) {
    await query(
      `INSERT IGNORE INTO therapist_specializations (therapist_id, specialization_id)
       VALUES (:tid, :sid)`,
      { tid: therapistId, sid: s.id }
    );
  }

  await query(
    `INSERT INTO therapist_licenses (therapist_id, license_number, expiry_date, issuer)
     SELECT :tid, 'SCFHS-445566', '2028-12-31', 'SCFHS'
     FROM DUAL WHERE NOT EXISTS (
       SELECT 1 FROM therapist_licenses WHERE therapist_id = :tid AND license_number = 'SCFHS-445566'
     )`,
    { tid: therapistId }
  );

  await query(
    `INSERT INTO therapist_degrees (therapist_id, degree_title, institution, year_awarded)
     SELECT :tid, 'PhD Clinical Psychology', 'King Saud University', 2016
     FROM DUAL WHERE NOT EXISTS (
       SELECT 1 FROM therapist_degrees WHERE therapist_id = :tid AND degree_title = 'PhD Clinical Psychology'
     )`,
    { tid: therapistId }
  );

  await query(
    `INSERT INTO wallets (user_id, balance, currency)
     VALUES (:uid, 5240.00, 'SAR')
     ON DUPLICATE KEY UPDATE balance = VALUES(balance)`,
    { uid: therapistId }
  );
  const wallets = await query(`SELECT id FROM wallets WHERE user_id = :uid`, { uid: therapistId });
  const walletId = wallets[0].id;

  const txCount = await query(`SELECT COUNT(*) AS c FROM wallet_transactions WHERE user_id = :uid`, {
    uid: therapistId,
  });
  if (!txCount[0].c) {
    await query(
      `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, currency, description, reference_type)
       VALUES
       (:wid, :uid, 'session_fee', 350.00, 'SAR', 'Session with Ahmad', 'session'),
       (:wid, :uid, 'session_fee', 350.00, 'SAR', 'Session with Lina', 'session'),
       (:wid, :uid, 'payout', 1000.00, 'SAR', 'Weekly payout', 'payout')`,
      { wid: walletId, uid: therapistId }
    );
  }

  const clients = [
    ['Ahmad Hassan', 'ahmad@example.com', '+966501111111'],
    ['Lina Omar', 'lina@example.com', '+966502222222'],
    ['Yousef Ali', 'yousef@example.com', '+966503333333'],
  ];
  for (const [full_name, email, phone] of clients) {
    const existing = await query(
      `SELECT id FROM therapist_clients WHERE therapist_id = :tid AND email = :email`,
      { tid: therapistId, email }
    );
    if (!existing.length) {
      await query(
        `INSERT INTO therapist_clients (therapist_id, full_name, email, phone, status)
         VALUES (:tid, :full_name, :email, :phone, 'active')`,
        { tid: therapistId, full_name, email, phone }
      );
    }
  }

  const clientRows = await query(`SELECT id, full_name FROM therapist_clients WHERE therapist_id = :tid`, {
    tid: therapistId,
  });
  const sessionCount = await query(`SELECT COUNT(*) AS c FROM sessions WHERE therapist_id = :tid`, {
    tid: therapistId,
  });
  if (!sessionCount[0].c && clientRows.length) {
    const c1 = clientRows[0].id;
    await query(
      `INSERT INTO sessions
        (therapist_id, client_id, title, session_type, status, starts_at, ends_at, duration_minutes, fee_amount, currency, join_url)
       VALUES
        (:tid, :c1, 'Follow-up session', 'video', 'scheduled',
         DATE_ADD(NOW(), INTERVAL 2 HOUR), DATE_ADD(NOW(), INTERVAL 170 MINUTE), 50, 350.00, 'SAR',
         'https://meet.nafs.app/demo-room'),
        (:tid, :c1, 'Initial assessment', 'video', 'completed',
         DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY) + INTERVAL 50 MINUTE, 50, 350.00, 'SAR',
         NULL)`,
      { tid: therapistId, c1 }
    );
  }

  for (let day = 0; day <= 4; day += 1) {
    await query(
      `INSERT INTO availability_slots (therapist_id, weekday, start_time, end_time)
       SELECT :tid, :day, '09:00:00', '17:00:00' FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM availability_slots WHERE therapist_id = :tid AND weekday = :day
       )`,
      { tid: therapistId, day }
    );
  }

  await query(
    `INSERT INTO payment_methods (user_id, brand, last4, exp_month, exp_year, is_default)
     SELECT :uid, 'visa', '4242', 12, 2028, 1 FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE user_id = :uid)`,
    { uid: therapistId }
  );

  const faqCount = await query(`SELECT COUNT(*) AS c FROM faqs`);
  if (!faqCount[0].c) {
    await query(
      `INSERT INTO faqs (question_en, answer_en, question_ar, answer_ar, sort_order) VALUES
       ('How do I join a video session?', 'Open Home or Calendar and tap Join on the upcoming session card.',
        'كيف أنضم لجلسة فيديو؟', 'افتح الرئيسية أو التقويم واضغط انضمام على بطاقة الجلسة.', 1),
       ('When do I get paid?', 'Earnings settle to your wallet after completed sessions. Payouts process weekly.',
        'متى أحصل على مستحقاتي؟', 'تُضاف الأرباح بعد اكتمال الجلسات ويتم التحويل أسبوعياً.', 2)`
    );
  }

  await query(
    `INSERT INTO policies (slug, title_en, body_en, title_ar, body_ar)
     VALUES
     ('privacy', 'Privacy Policy', 'Nafs protects client confidentiality and therapist data.',
      'سياسة الخصوصية', 'تحمي نفس خصوصية العملاء والمعالجين.'),
     ('terms', 'Terms of Use', 'By using Nafs you agree to platform terms for telehealth practice.',
      'شروط الاستخدام', 'باستخدام نفس فإنك توافق على شروط المنصة.')
     ON DUPLICATE KEY UPDATE title_en = VALUES(title_en)`
  );

  // Demo client (patient) for mood / journal / booking flows
  await query(
    `INSERT INTO users (email, phone, password_hash, full_name, role, locale, is_verified)
     VALUES (:email, :phone, :password_hash, :full_name, 'client', 'en', 1)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = 'client'`,
    {
      email: 'client@nafs.app',
      phone: '+966504444444',
      password_hash: passwordHash,
      full_name: 'Noura Client',
    }
  );
  const clientUsers = await query(`SELECT id FROM users WHERE email = :email`, {
    email: 'client@nafs.app',
  });
  const clientUserId = clientUsers[0].id;

  await query(
    `INSERT INTO client_profiles
      (user_id, gender, city, country, preferred_language, preferred_therapist_gender, concerns, about, onboarding_completed)
     VALUES
      (:uid, 'female', 'Riyadh', 'Saudi Arabia', 'en', 'any', :concerns, 'Demo client account', 1)
     ON DUPLICATE KEY UPDATE
       city = VALUES(city),
       onboarding_completed = 1`,
    { uid: clientUserId, concerns: JSON.stringify(['anxiety', 'sleep']) }
  );
  await query(
    `INSERT INTO user_onboarding (user_id, role, step, completed, completed_at, payload)
     VALUES (:uid, 'client', 'done', 1, NOW(), :payload)
     ON DUPLICATE KEY UPDATE completed = 1, step = 'done'`,
    {
      uid: clientUserId,
      payload: JSON.stringify({ goals: ['Sleep better', 'Reduce anxiety'], completed: true }),
    }
  );
  await query(
    `INSERT INTO user_onboarding (user_id, role, step, completed, completed_at)
     VALUES (:uid, 'therapist', 'done', 1, NOW())
     ON DUPLICATE KEY UPDATE completed = 1, step = 'done'`,
    { uid: therapistId }
  );

  const moodCount = await query(`SELECT COUNT(*) AS c FROM mood_checkins WHERE user_id = :uid`, {
    uid: clientUserId,
  });
  if (!moodCount[0].c) {
    await query(
      `INSERT INTO mood_checkins (user_id, mood, intensity, note, tags)
       VALUES (:uid, 'calm', 7, 'Feeling steady after walk', :tags)`,
      { uid: clientUserId, tags: JSON.stringify(['walk', 'morning']) }
    );
  }

  const journalCount = await query(`SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = :uid`, {
    uid: clientUserId,
  });
  if (!journalCount[0].c) {
    await query(
      `INSERT INTO journal_entries (user_id, entry_type, title, body, mood_tag, is_pinned, entry_date)
       VALUES (:uid, 'gratitude', 'Three good things', 'Family call, tea, finished work early.', 'grateful', 1, CURDATE())`,
      { uid: clientUserId }
    );
  }

  await query(
    `INSERT INTO user_goals (user_id, goals)
     VALUES (:uid, :goals)
     ON DUPLICATE KEY UPDATE goals = VALUES(goals)`,
    { uid: clientUserId, goals: JSON.stringify(['Sleep better', 'Reduce anxiety', 'Weekly check-in']) }
  );

  await query(
    `INSERT INTO notification_preferences (user_id)
     VALUES (:uid)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    { uid: clientUserId }
  );
  await query(
    `INSERT INTO notification_preferences (user_id)
     VALUES (:uid)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    { uid: therapistId }
  );

  await query(
    `INSERT INTO user_consents (user_id, consent_key, enabled)
     VALUES (:uid, 'mood_detector', 1), (:uid, 'session_recording', 0)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    { uid: clientUserId }
  );

  return {
    therapist: { email: 'demo@nafs.app', password: 'Password123!' },
    client: { email: 'client@nafs.app', password: 'Password123!' },
  };
}

if (require.main === module) {
  runSeed()
    .then((accounts) => {
      console.log('Seed complete.');
      console.log(`  Therapist: ${accounts.therapist.email} / ${accounts.therapist.password}`);
      console.log(`  Client:    ${accounts.client.email} / ${accounts.client.password}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = { runSeed };
