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

## Postman

Import from `postman/`:

- `Nafs-API.postman_collection.json`
- `Nafs-Local.postman_environment.json`
- `Nafs-Hostinger.postman_environment.json`

## Hostinger

Use `hostinger.env` with **Import .env**, then after deploy run `npm run db:setup`.

## Docs

- `docs/figma-all-pages-apis.md` — screen → endpoint map
- `docs/figma-screen-map.md` — Figma screen overview
- `docs/API.md` — API reference
