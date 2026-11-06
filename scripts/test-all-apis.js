/**
 * Smoke-test Nafs API endpoints against a running local server.
 * Usage: node scripts/test-all-apis.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:43125/api/v1';

let passed = 0;
let failed = 0;
const failures = [];

async function req(method, path, { token, body, expectOk = true, label } = {}) {
  const name = label || `${method} ${path}`;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const okHttp = res.status >= 200 && res.status < 300;
    const okBody = json == null || json.success !== false;
    const ok = expectOk ? okHttp && okBody : !okHttp || json?.success === false;
    if (ok) {
      passed += 1;
      console.log(`✓ ${name} [${res.status}]`);
    } else {
      failed += 1;
      const msg = json?.message || res.statusText || 'unknown';
      failures.push(`${name} → ${res.status} ${msg}`);
      console.log(`✗ ${name} [${res.status}] ${msg}`);
    }
    return { res, json, ok };
  } catch (e) {
    failed += 1;
    failures.push(`${name} → ${e.message}`);
    console.log(`✗ ${name} → ${e.message}`);
    return { ok: false, error: e };
  }
}

async function main() {
  console.log(`Testing ${BASE}\n`);

  await req('GET', '/health', { label: 'GET /health' });
  await req('GET', '/app/bootstrap', { label: 'GET /app/bootstrap' });
  await req('GET', '/specializations', { label: 'GET /specializations' });
  await req('GET', '/faqs?locale=en', { label: 'GET /faqs' });
  await req('GET', '/policies', { label: 'GET /policies' });
  // Exercises require auth — tested after login below.

  // Client login
  const clientLogin = await req('POST', '/auth/login', {
    body: { email: 'client@nafs.app', password: 'Password123!' },
    label: 'POST /auth/login (client)',
  });
  const clientToken = clientLogin.json?.data?.token;
  if (!clientToken) {
    console.error('No client token — aborting authenticated tests');
    process.exit(1);
  }

  // Therapist login
  const therapistLogin = await req('POST', '/auth/login', {
    body: { email: 'demo@nafs.app', password: 'Password123!' },
    label: 'POST /auth/login (therapist)',
  });
  const therapistToken = therapistLogin.json?.data?.token;
  if (!therapistToken) {
    console.error('No therapist token — aborting');
    process.exit(1);
  }

  // Shared authenticated
  for (const [tok, role] of [
    [clientToken, 'client'],
    [therapistToken, 'therapist'],
  ]) {
    await req('GET', '/auth/me', { token: tok, label: `GET /auth/me (${role})` });
    await req('GET', '/onboarding', { token: tok, label: `GET /onboarding (${role})` });
    await req('GET', '/home/dashboard', { token: tok, label: `GET /home/dashboard (${role})` });
    await req('GET', '/profile', { token: tok, label: `GET /profile (${role})` });
    await req('GET', '/notifications', { token: tok, label: `GET /notifications (${role})` });
    await req('GET', '/notifications/preferences', {
      token: tok,
      label: `GET /notifications/preferences (${role})`,
    });
    await req('GET', '/devices', { token: tok, label: `GET /devices (${role})` });
    await req('GET', '/settings', { token: tok, label: `GET /settings (${role})` });
    await req('GET', '/privacy/consents', { token: tok, label: `GET /privacy/consents (${role})` });
    await req('GET', '/privacy/media', { token: tok, label: `GET /privacy/media (${role})` });
    await req('GET', '/privacy/exports', { token: tok, label: `GET /privacy/exports (${role})` });
    await req('GET', '/privacy/retention', { token: tok, label: `GET /privacy/retention (${role})` });
    await req('GET', '/chats', { token: tok, label: `GET /chats (${role})` });
  }

  // Client wellness
  await req('POST', '/mood/checkins', {
    token: clientToken,
    body: { mood: 'calm', intensity: 6, note: 'api test', tags: ['test'] },
    label: 'POST /mood/checkins',
  });
  await req('GET', '/mood/checkins', { token: clientToken, label: 'GET /mood/checkins' });
  await req('POST', '/mood/detector', {
    token: clientToken,
    body: { detected_mood: 'happy', confidence: 0.8, consent_accepted: true },
    label: 'POST /mood/detector',
  });

  const journal = await req('POST', '/journals', {
    token: clientToken,
    body: {
      title: 'API test entry',
      entry_date: new Date().toISOString(),
      is_pinned: false,
      blocks: [
        { type: 'text', text: 'Hello from smoke test' },
        { type: 'text', text: 'Second note' },
      ],
    },
    label: 'POST /journals (blocks)',
  });
  const journalId = journal.json?.data?.entry?.id;
  await req('GET', '/journals', { token: clientToken, label: 'GET /journals' });
  if (journalId) {
    await req('GET', `/journals/${journalId}`, { token: clientToken, label: 'GET /journals/:id' });
    await req('PUT', `/journals/${journalId}`, {
      token: clientToken,
      body: {
        title: 'Updated',
        blocks: [{ type: 'text', text: 'Updated body' }],
      },
      label: 'PUT /journals/:id (blocks)',
    });
  }

  await req('GET', '/goals', { token: clientToken, label: 'GET /goals' });
  await req('PUT', '/goals', {
    token: clientToken,
    body: { goals: ['sleep better', 'reduce anxiety'] },
    label: 'PUT /goals',
  });

  const assessment = await req('POST', '/assessments', {
    token: clientToken,
    body: { assessment_type: 'general_mood' },
    label: 'POST /assessments',
  });
  const assessmentId = assessment.json?.data?.assessment?.id;
  if (assessmentId) {
    await req('POST', `/assessments/${assessmentId}/answers`, {
      token: clientToken,
      body: {
        answers: [{ question_key: 'q1', answer_value: '3' }],
        complete: true,
        score: 70,
        summary: { headline: 'Smoke test summary', detail: 'ok' },
      },
      label: 'POST /assessments/:id/answers',
    });
  }
  await req('GET', '/assessments', { token: clientToken, label: 'GET /assessments' });

  await req('GET', '/specialists', { token: clientToken, label: 'GET /specialists' });
  const specialists = await req('GET', '/specialists', { token: clientToken });
  const specialistId = specialists.json?.data?.specialists?.[0]?.id;
  if (specialistId) {
    await req('GET', `/specialists/${specialistId}`, {
      token: clientToken,
      label: 'GET /specialists/:id',
    });
    await req('GET', `/specialists/${specialistId}/availability?days=5`, {
      token: clientToken,
      label: 'GET /specialists/:id/availability',
    });
    const booking = await req('POST', '/bookings', {
      token: clientToken,
      body: {
        therapist_id: specialistId,
        booking_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
        booking_time: '14:00:00',
        session_type: 'video',
        amount: 150,
        currency: 'SAR',
      },
      label: 'POST /bookings',
    });
    const bookingId = booking.json?.data?.booking?.id;
    if (bookingId) {
      await req('POST', `/bookings/${bookingId}/checkout`, {
        token: clientToken,
        body: { payment_method: 'card' },
        label: 'POST /bookings/:id/checkout',
      });
    }
  }
  await req('GET', '/bookings', { token: clientToken, label: 'GET /bookings' });
  await req('GET', '/exercises', { token: clientToken, label: 'GET /exercises (auth)' });
  const exercises = await req('GET', '/exercises', { token: clientToken });
  const exerciseId = exercises.json?.data?.exercises?.[0]?.id;
  if (exerciseId) {
    await req('GET', `/exercises/${exerciseId}`, {
      token: clientToken,
      label: 'GET /exercises/:id',
    });
  }

  await req('GET', '/payment-methods', { token: clientToken, label: 'GET /payment-methods' });
  await req('GET', '/billing-history', { token: clientToken, label: 'GET /billing-history' });

  await req('POST', '/contact', {
    body: { name: 'Test', email: 'test@example.com', subject: 'Hi', message: 'Smoke test' },
    label: 'POST /contact',
  });
  await req('POST', '/report-problem', {
    token: clientToken,
    body: { category: 'bug', description: 'Smoke test report' },
    label: 'POST /report-problem',
  });

  // Therapist ops
  await req('GET', '/sessions', { token: therapistToken, label: 'GET /sessions' });
  const month = new Date().toISOString().slice(0, 7);
  await req('GET', `/calendar?month=${month}`, { token: therapistToken, label: 'GET /calendar' });
  await req('GET', '/availability', { token: therapistToken, label: 'GET /availability' });
  await req('PUT', '/availability', {
    token: therapistToken,
    body: {
      slots: [
        { weekday: 1, start_time: '09:00', end_time: '12:00' },
        { weekday: 3, start_time: '14:00', end_time: '18:00' },
      ],
    },
    label: 'PUT /availability',
  });
  await req('GET', '/clients', { token: therapistToken, label: 'GET /clients' });
  const clients = await req('GET', '/clients', { token: therapistToken });
  const clientRowId = clients.json?.data?.clients?.[0]?.id;
  if (clientRowId) {
    await req('GET', `/clients/${clientRowId}`, {
      token: therapistToken,
      label: 'GET /clients/:id',
    });
  }
  await req('GET', '/wallet', { token: therapistToken, label: 'GET /wallet' });
  await req('GET', '/wallet/transactions', {
    token: therapistToken,
    label: 'GET /wallet/transactions',
  });
  await req('GET', '/wallet/overview', { token: therapistToken, label: 'GET /wallet/overview' });
  await req('GET', '/vacations', { token: therapistToken, label: 'GET /vacations' });
  await req('POST', '/vacations', {
    token: therapistToken,
    body: {
      start_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 86400000 * 35).toISOString().slice(0, 10),
      reason: 'Smoke test leave',
    },
    label: 'POST /vacations',
  });
  await req('GET', '/payouts', { token: therapistToken, label: 'GET /payouts' });
  await req('POST', '/payouts', {
    token: therapistToken,
    body: { amount: 50, bank_name: 'Test Bank', iban: 'SA0000000000000000000000', currency: 'SAR' },
    label: 'POST /payouts',
  });

  await req('PATCH', '/profile', {
    token: therapistToken,
    body: {
      bio: 'Updated bio from smoke test',
      headline: 'Smoke test headline',
      frameworks: ['CBT', 'ACT'],
    },
    label: 'PATCH /profile (therapist)',
  });

  // Join a session if the therapist has one
  const sessions = await req('GET', '/sessions', { token: therapistToken });
  const sessionId = sessions.json?.data?.sessions?.[0]?.id;
  if (sessionId) {
    await req('POST', `/sessions/${sessionId}/join`, {
      token: therapistToken,
      body: {},
      label: 'POST /sessions/:id/join',
    });
  }

  // Cleanup journal
  if (journalId) {
    await req('DELETE', `/journals/${journalId}`, {
      token: clientToken,
      label: 'DELETE /journals/:id',
    });
  }

  console.log(`\n———\nPassed: ${passed}  Failed: ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
