# Nafs API

Node.js + MySQL REST backend for the **Nafs** mobile app (auth, onboarding, home dashboard, prayer logs, dhikr, journals, habits, challenges, Qur’an progress, fasting, notifications).

> **Figma note:** The linked design file (`tkBoHPyvyuhwBW3rvjPMtN` / Nafs-mobile) could not be read in this environment (Figma MCP auth unavailable; REST needs `FIGMA_ACCESS_TOKEN`). APIs below follow the common Nafs companion product flow. After you add a token, run `npm run figma:fetch` and we can reshape endpoints to match exact screens.

## Stack

- Node.js 22 + Express
- MySQL 8
- JWT auth, Joi validation, Swagger UI

This cloud environment does **not** use XAMPP. Node runs standalone; MySQL is a local MySQL 8 server. On your own machine with XAMPP:

1. Start **MySQL** from the XAMPP control panel (Apache optional — this API does not need PHP/Apache).
2. Install Node.js from [nodejs.org](https://nodejs.org/) (Node is not installed “inside” XAMPP).
3. Create DB/user in phpMyAdmin or MySQL shell, then point `.env` at `localhost:3306`.

## Quick start

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

- App explorer: http://127.0.0.1:43125/
- Swagger docs: http://127.0.0.1:43125/api/docs
- API base: http://127.0.0.1:43125/api/v1

### Demo user

| Field | Value |
| --- | --- |
| Email | `demo@nafs.app` |
| Password | `Password123!` |

## MySQL (this environment)

```bash
# already created during setup
# database: nafs
# user: nafs / nafs_pass
# root: nafs_root_pass
```

Connect with TCP (`127.0.0.1`), not the Unix socket, if you hit permission errors.

## API map

| Area | Methods |
| --- | --- |
| Auth | `POST /auth/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `GET /auth/me` |
| Onboarding | `GET /onboarding/steps`, `GET /onboarding/status`, `POST /onboarding/complete` |
| Home | `GET /home/dashboard` |
| Profile | `GET/PATCH /profile` |
| Prayers | `POST /prayers/log`, `GET /prayers/day`, `GET /prayers/calendar` |
| Dhikr | `GET /dhikr/presets`, `POST/GET /dhikr/sessions`, `POST /dhikr/sessions/:id/tick` |
| Journals | `CRUD /journals` |
| Habits | `POST/GET /habits`, `POST /habits/:id/log`, `GET /habits/:id/streak` |
| Challenges | `GET /challenges`, `POST /challenges/:id/join`, `GET /me/challenges`, complete task |
| Qur’an | `GET/PUT /quran/progress`, reflections |
| Fasting | `POST /fasting/log`, `GET /fasting` |
| Content | `GET /content`, `/content/daily` |
| Notifications | list / mark read / register device |

All authenticated routes use `Authorization: Bearer <token>`.

## Figma sync

```bash
export FIGMA_ACCESS_TOKEN=figd_xxx
npm run figma:fetch
```

Writes `docs/figma-inventory.json` with page/frame names from the design file.
