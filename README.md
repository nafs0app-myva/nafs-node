# Nafs

Node.js + MySQL REST backend for the **Nafs** mobile app — therapist + client mental-health platform (from Figma **NAFS-backup**).

## Product flows covered

**Consultant:** registration / multi-step application, home dashboard, calendar & sessions, clients, wallet & payouts, vacation/time off, chat, profile & settings.

**Client:** mood check-ins & detector, journal, assessments & goals, browse specialists, book + checkout.

**Shared:** notifications, devices, privacy consents / media / data export, FAQ, policies, contact, report a problem (EN/AR).

## Quick start

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

- Explorer: http://127.0.0.1:43125/
- Swagger: http://127.0.0.1:43125/api/docs
- API base: http://127.0.0.1:43125/api/v1

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Therapist | `demo@nafs.app` | `Password123!` |
| Client | `client@nafs.app` | `Password123!` |

### Mobile app contract (v2.2)

| Need | Endpoint |
| --- | --- |
| Email verification OTP | `POST /auth/register` sends code; confirm with `POST /auth/verify-email`; resend via `POST /auth/resend-verification`. Forgot-password uses the same mailer. |
| Onboarding (both roles) | Shared `GET/PUT /onboarding` — role from JWT (not body). Therapist licensing still uses `/application/*`. |
| Client profile | `GET /auth/me` and `GET/PATCH /profile` return/update `client_profiles`. |
| Dashboard | `GET /home/dashboard` is role-aware (client + therapist summaries). |

Set `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` for real email. Without SMTP, OTPs are written to `email_outbox` (and returned in non-production responses).

## Postman

Synced to **My Workspace** (cloud):

- Collection **nafse-api** — all 94 endpoints
- Collection **Nafs API** — same full set
- Environments **Nafs Hostinger** (`https://myva.ae/api/v1`) and **Nafs Local**

Repo copies under `postman/` if you prefer file import.

## Hostinger / live

Live API: https://myva.ae/api/v1  

Use `hostinger.env` with **Import .env** (includes `DB_NAME=u809513268_nafs` and `SETUP_KEY`). After deploy, migrate + seed remotely:

```bash
curl -X POST https://myva.ae/api/v1/admin/db-setup \
  -H 'Content-Type: application/json' \
  -H 'X-Setup-Key: YOUR_SETUP_KEY' \
  -d '{"migrate_only":false}'
```

Or on the Hostinger Node terminal: `npm run db:setup`.

## Docs

- `docs/figma-all-pages-apis.md` — screen → endpoint map
- `docs/figma-screen-map.md` — Figma screen overview
- `docs/API.md` — API reference
