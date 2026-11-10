# Nafs API (from NAFS-backup Figma)

Base URL: `/api/v1`  
Auth: `Authorization: Bearer <jwt>`  
Demo therapist: `demo@nafs.app` / `Password123!`  
Demo client: `client@nafs.app` / `Password123!`

Live: `https://myva.ae/api/v1` (OpenAPI `2.2.0+`)

## Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Sends real email OTP |
| POST | `/auth/login` | |
| POST | `/auth/verify-email` | `{ email, code }` — code from email, not `123456` |
| POST | `/auth/resend-verification` | `{ email }` |
| POST | `/auth/forgot-password` | Sends real email OTP |
| POST | `/auth/reset-password` | |
| POST | `/auth/change-password` | Does not revoke other JWTs |
| GET | `/auth/me` | Includes role `profile` + `onboarding` (+ `application` for therapists) |

## Shared onboarding (client + therapist first-run)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/onboarding` | Role from JWT |
| PUT | `/onboarding` | Partial OK. Set `completed: true` when done |

Client completion flag: `onboarding.completed` and `profile.onboarding_completed` on `/auth/me`.

`city`, `preferred_therapist_gender`, `concerns[]` are **optional** — can skip at intake and fill later via `PATCH /profile`.

## Therapist application (licensing)
| Method | Path | App screen |
| --- | --- | --- |
| GET | `/specializations` | Experience |
| GET | `/application` | |
| GET | `/application/status` | |
| PUT | `/application/identity` | **Identity** — name, gender, age\|DOB, licenses[], degrees[] |
| PUT | `/application/experience` | **Experience** — specialization_ids, years_experience \| years_in_specialization |
| PUT | `/application/admin-tech` | **Admin** — session_fee_default + slots[] (weekly schedule) |
| POST | `/application/submit` | After all three steps have payloads |

### Identity body (aligned to Identity screen)
```json
{
  "full_name": "Dr. Sara",
  "gender": "female",
  "age": 36,
  "licenses": [{ "license_number": "SCFHS-1", "issuer": "SCFHS", "expiry_date": "2028-12-31" }],
  "degrees": [{ "degree_title": "PhD", "institution": "KSU", "year_awarded": 2016 }]
}
```
Optional: `identity_number`, `date_of_birth`, `bio`, `working_capacity`.  
**Licenses/degrees belong on identity** (not experience).

### Experience body
```json
{
  "specialization_ids": [1, 2],
  "years_in_specialization": 8
}
```
(`years_experience` also accepted; either is enough.)

### Admin-tech body (aligned to Admin fees/schedule screen)
```json
{
  "session_fee_default": 350,
  "slots": [
    { "weekday": 0, "start_time": "09:00", "end_time": "17:00", "is_active": true }
  ]
}
```
Address/video fields are optional. Weekly schedule can also be saved with `PUT /availability` (same `slots` shape).

## Home / Calendar / Sessions
| Method | Path |
| --- | --- |
| GET | `/home/dashboard` | **Role-aware**. Client: `today_tasks` + `today_exercises` / `my_plan` from `user_exercise_plan` |
| GET | `/calendar?month=YYYY-MM` |
| GET/POST | `/sessions` |
| GET/PATCH | `/sessions/:id` |
| POST | `/sessions/:id/join` |
| POST | `/sessions/:id/notes` |
| GET/PUT | `/availability` |

## Clients
| Method | Path |
| --- | --- |
| GET/POST | `/clients` |
| GET/PATCH | `/clients/:id` |

## Wallet / Billing / Payouts
| Method | Path |
| --- | --- |
| GET | `/wallet` |
| GET | `/wallet/transactions` |
| GET | `/wallet/overview` |
| POST | `/wallet/withdraw` |
| GET/POST | `/payment-methods` |
| PATCH/DELETE | `/payment-methods/:id` |
| GET | `/billing-history` |
| GET | `/payments/options` |
| GET | `/bookings/:id/checkout-summary` |
| POST | `/bookings/:id/pay` |
| GET | `/payments/:bookingId/status` |
| POST | `/payments/webhook` |
| GET | `/payments/return` |
| GET/POST | `/payouts` |

## Chat
| Method | Path |
| --- | --- |
| GET/POST | `/chats` |
| GET | `/chats/:id/messages` |
| POST | `/chats/:id/messages` |

## Consultant vacation
| Method | Path |
| --- | --- |
| GET/POST | `/vacations` |
| DELETE | `/vacations/:id` |

## Client wellness (still live — complementary to `/onboarding`)
| Method | Path | Purpose |
| --- | --- | --- |
| POST/GET | `/mood/checkins` | Ongoing mood |
| POST | `/mood/detector` | |
| GET/POST | `/journals` | Ordered `blocks[]` (1–50: text\|audio\|image\|video). Upload media first via `POST /privacy/media/upload` with `purpose=journal`. Legacy `body`/`media_url`/`notes`/`media` still accepted. List returns `block_count` + `preview_block` (not full blocks). `q` also searches text blocks. |
| GET | `/journals/prompt` | next unanswered rotating prompt |
| GET/PUT/DELETE | `/journals/:id` | Detail includes ordered `blocks[]` plus legacy `body`/`media_url`. PUT replaces blocks only when `blocks[]` is sent. DELETE also removes attached media files. |
| GET/POST | `/journal-prompts` | admin prompt pool |
| PATCH | `/journal-prompts/:id` | admin |
| POST | `/assessments` | Optional quizzes (not the primary onboarding gate) |
| POST | `/assessments/:id/answers` | |
| GET | `/assessments` | |
| GET/PUT | `/goals` | Goals list (also settable via `PUT /onboarding`) |
| GET | `/exercises` | Read-only catalogue |
| GET | `/exercises/:id` | Detail + `on_plan` / `done` |
| GET | `/plan/exercises` | This user's My Plan (empty until adds) |
| POST | `/plan/exercises` | Add `{ exercise_id }` (idempotent; rejects unknown ids) |
| DELETE | `/plan/exercises/:exercise_id` | Remove from plan |
| POST | `/plan/exercises/:exercise_id/complete` | Set `completed_at` (today `done`) and append `exercise_completions` row |
| GET | `/progress/summary` | Progress tab cards. Query: `period=weekly\|monthly`, `tz_offset` minutes east of UTC (e.g. `180` Riyadh). Returns averages, best/difficult day, plan %, most-used exercise, frequent trigger (causes only), `has_enough_data`, `ai_insights_enabled`, and aggregate `ai_input`. Null when no data. |
| GET | `/progress/insight` | Cached AI insight for the current period window (`period`, `tz_offset`). `data.insight` is null when none. |
| PUT | `/progress/insight` | Upsert cached insight `{ period, period_start, summary, direction, stability }` (app-generated GPT text). |

## Client specialists / booking
| Method | Path |
| --- | --- |
| GET | `/specialists` |
| GET | `/specialists/:id` |
| POST/GET | `/bookings` |
| POST | `/bookings/:id/checkout` |

## Profile / Support / Privacy
| Method | Path |
| --- | --- |
| GET/PATCH | `/profile` | Role-aware create/update |
| GET | `/faqs` |
| GET | `/policies`, `/policies/:slug` |
| POST | `/contact` |
| POST | `/report-problem` |
| GET | `/notifications` |
| POST | `/notifications/test-push` | Send a real FCM test to this user's devices |
| GET/PATCH | `/notifications/preferences` |
| POST/GET | `/devices` | Register FCM token (`token`, `platform`) |
| DELETE | `/devices/:id` |
| GET | `/admin/push-status` | Setup-key: FCM configured? OAuth OK? device count |
| POST | `/admin/push-config` | Setup-key: save FCM service account into `app_secrets` |
| GET/PUT | `/privacy/consents` |
| GET/POST | `/privacy/media` | List is `purpose=recording` only (journal uploads excluded) |
| POST | `/privacy/media/upload` | Multipart `file` (+ optional `thumbnail`); `media_type` audio\|photo\|video; `purpose` recording\|journal. Limits: photo 10 MB, audio 25 MB, video 100 MB. Disk storage + Range/206 on file GET. Returns `thumbnail_url` when a thumb is provided. |
| GET | `/privacy/media/:id/file` | Owner-only; supports `Range` / `206 Partial Content` |
| GET | `/privacy/media/:id/thumbnail` | Owner-only video/image thumbnail |
| DELETE | `/privacy/media/:id` |
| POST/GET | `/privacy/export(s)` | Journal export includes `blocks[]` + media refs |
| GET | `/privacy/retention` |

### Journal `blocks[]` (create / update)

```json
{
  "title": "My day",
  "mood_tag": "grateful",
  "entry_type": "mixed",
  "entry_date": "2026-11-06T10:00:00Z",
  "is_pinned": false,
  "prompt_id": null,
  "blocks": [
    { "type": "text", "text": "Morning walk..." },
    { "type": "video", "media_id": 123 },
    { "type": "text", "text": "Then lunch..." },
    { "type": "audio", "media_id": 125 },
    { "type": "image", "media_id": 126 }
  ]
}
```

- `sort_order` is assigned server-side from array index (do not send it).
- `entry_type` is inferred from block kinds (`mixed` when more than one kind; `gratitude` kept when sent).
- `entry_date` is `DATETIME` (ISO timestamps preserve time of day).
- Unattached `purpose=journal` media older than 24h is cleaned up automatically.

### Media storage decisions

| Question | Decision |
| --- | --- |
| Disk or S3? | Local disk under `storage/media/{userId}/` (Hostinger-friendly). S3/presigned upload can come later. |
| Size limits | photo **10 MB**, audio **25 MB**, video **100 MB** (422 when exceeded) |
| Thumbnails | App may send optional multipart `thumbnail`; no ffmpeg dependency on the server |
| Therapist access | File/thumbnail URLs stay **owner-only** (unchanged) |
| `entry_date` | **DATETIME** so the app keeps time of day (`h:mm a`) |
