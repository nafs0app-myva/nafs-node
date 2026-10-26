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
| GET | `/home/dashboard` | **Role-aware** (client + therapist) |
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
| GET | `/billing-history` |
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
| GET/POST | `/journals` | |
| GET/PUT/DELETE | `/journals/:id` | |
| POST | `/assessments` | Optional quizzes (not the primary onboarding gate) |
| POST | `/assessments/:id/answers` | |
| GET | `/assessments` | |
| GET/PUT | `/goals` | Goals list (also settable via `PUT /onboarding`) |

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
| GET/PATCH | `/notifications/preferences` |
| POST/GET | `/devices` |
| DELETE | `/devices/:id` |
| GET/PUT | `/privacy/consents` |
| GET/POST | `/privacy/media` |
| DELETE | `/privacy/media/:id` |
| POST/GET | `/privacy/export(s)` |
| GET | `/privacy/retention` |
