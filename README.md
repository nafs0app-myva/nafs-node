# Nafs

Node.js + MySQL REST backend for the **Nafs** mobile app — therapist consultation platform (from Figma Nafs-mobile).

## Product flows covered

- Therapist registration / multi-step application (identity, experience, admin/tech, submitted)
- Home dashboard (next video session + Join)
- Calendar & sessions
- Clients list + client detail
- Wallet / earnings / payment methods / billing
- Chat threads
- Profile, change password, FAQ, policies, contact, report a problem
- EN/AR content fields for FAQ & policies

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

### Demo therapist

| Field | Value |
| --- | --- |
| Email | `demo@nafs.app` |
| Password | `Password123!` |

## Postman

Import from `postman/`:

- `Nafs-API.postman_collection.json`
- `Nafs-Local.postman_environment.json`
- `Nafs-Hostinger.postman_environment.json`

## Hostinger

Use `hostinger.env` with **Import .env**, then after deploy run `npm run db:setup`.

## Docs

See `docs/API.md` and `docs/figma-screen-map.md`.
