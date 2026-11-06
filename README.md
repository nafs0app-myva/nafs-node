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
 npm run db:seed 
npm run dev
```

> **Warning:** `npm run db:setup` runs `src/db/schema.sql`, which **drops and recreates every table**, deleting all existing data. Use it only on a fresh or throwaway database. To re-add the demo accounts to an existing database, run just `npm run db:seed`, which inserts or updates the seed rows without dropping anything.

### MySQL via Docker

If you do not have a local MySQL, run one that matches `.env.example`:

```bash
docker run -d --name nafs-mysql ^
  -e MYSQL_ROOT_PASSWORD=root ^
  -e MYSQL_DATABASE=nafs ^
  -e MYSQL_USER=nafs ^
  -e MYSQL_PASSWORD=nafs_pass ^
  -p 3306:3306 ^
  mysql:8.0 --default-authentication-plugin=mysql_native_password
```

Wait until the container is ready (`docker exec nafs-mysql mysqladmin ping -uroot -proot`), then `npm run db:setup`.

### API smoke test

With the server running:

```bash
node scripts/test-all-apis.js
# or against another host:
node scripts/test-all-apis.js http://127.0.0.1:43125/api/v1
```

- Website: http://127.0.0.1:43125/ (live: https://myva.ae/)
- Admin panel: http://127.0.0.1:43125/admin/ (live: https://myva.ae/admin/)
- Developers / API explorer: http://127.0.0.1:43125/developers/
- Swagger: http://127.0.0.1:43125/api/docs
- API base: http://127.0.0.1:43125/api/v1

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@myva.ae` | `Password123!` |
| Therapist | `demo@nafs.app` | `Password123!` |
| Client | `client@nafs.app` | `Password123!` |

### Agora video / audio tokens

`POST /sessions/:id/join` mints a real Agora RTC token when credentials are set:

- Hostinger env: `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE`, or
- Store in DB (survives redeploys):

```bash
curl -X POST https://myva.ae/api/v1/admin/agora-config \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: $SETUP_KEY" \
  -d '{"app_id":"YOUR_AGORA_APP_ID","app_certificate":"YOUR_AGORA_APP_CERTIFICATE"}'
```

Without both values, join still succeeds but `rtc_token` is `null` (Agora secured mode cannot connect).

### Stripe payments

`POST /bookings/:id/pay` opens a **Stripe Checkout** page when credentials are set
(card / Apple Pay / Google Pay when enabled in the Stripe Dashboard). Refunds on
cancel go back to the card via the PaymentIntent.

- Hostinger env: `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY`, or
- Store in DB (survives redeploys):

```bash
curl -X POST https://myva.ae/api/v1/admin/stripe-config \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: $SETUP_KEY" \
  -d '{"publishable_key":"pk_live_…","secret_key":"sk_live_…"}'
```

Optional webhook (auto-confirm after pay): point Stripe to  
`https://myva.ae/api/v1/payments/stripe/webhook` for `checkout.session.completed`.  
Without Stripe keys, checkout confirms without charging (dev mode). Moyasar remains a fallback if only `MOYASAR_SECRET_KEY` is set.

### Admin panel

Web UI at `/admin/` for platform admins (`role=admin`):

- Overview + today’s joins / sessions / bookings
- Daily activity (users & consultants added)
- List / deactivate / permanently delete users
- Add consultants
- Approve / reject consultant applications

Admin JWT APIs live under `/api/v1/admin/panel/*`.

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

- Collection **nafse-api** — all 150 endpoints
- Collection **Nafs API** — same full 150-route set
- Environments **Nafs Hostinger** (`https://myva.ae/api/v1`) and **Nafs Local**

Repo copies under `postman/` if you prefer file import.

## Hostinger / live

Live API: https://myva.ae/api/v1  

**Push (FCM):** Firebase HTTP v1. Set credentials with either Hostinger env
`FCM_SERVICE_ACCOUNT` (JSON/base64) or once via:

```bash
curl -X POST https://myva.ae/api/v1/admin/push-config \
  -H 'Content-Type: application/json' \
  -H 'X-Setup-Key: YOUR_SETUP_KEY' \
  -d '{"service_account":"<json or base64>"}'
```

Clients must `POST /devices` with the FCM token. Verify with
`POST /notifications/test-push` and `GET /admin/push-status`.

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
