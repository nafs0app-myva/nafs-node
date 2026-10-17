# All Figma pages → Nafs APIs

Mapped from **NAFS-backup** (`WPOo1LyxhjFJjUY7cAdcMx`) — English + Arabic.  
Base: `/api/v1`

## App / auth

| Figma page / screen | API(s) |
| --- | --- |
| Splash / language | `GET /app/bootstrap` |
| Login | `POST /auth/login` |
| Register / Sign up | `POST /auth/register` |
| Verify email OTP | `POST /auth/verify-email` |
| Forgot password | `POST /auth/forgot-password` |
| Reset password | `POST /auth/reset-password` |
| Change Password | `POST /auth/change-password` |
| Me / session restore | `GET /auth/me` |
| Settings / language | `GET/PATCH /settings` |

## Therapist onboarding

| Figma page / screen | API(s) |
| --- | --- |
| Identity & qualifications | `PUT /application/identity` |
| Experience & specializations | `GET /specializations`, `PUT /application/experience` |
| Administrative & technical | `PUT /application/admin-tech` |
| Application submitted | `POST /application/submit`, `GET /application/status` |

## Consultant home / practice

| Figma page / screen | API(s) |
| --- | --- |
| Home / Consultant dashboard | `GET /home/dashboard` |
| Join video session | `POST /sessions/:id/join` |
| Calendar | `GET /calendar?month=YYYY-MM`, `GET /sessions?date=` |
| Book / manage session | `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/:id/cancel` |
| Availability | `GET/PUT /availability` |
| Session notes | `POST /sessions/:id/notes` |
| Clients list (+ search) | `GET /clients?q=` |
| Client detail | `GET /clients/:id`, `PATCH /clients/:id` |
| Add client | `POST /clients` |
| Chat list | `GET /chats` |
| Chat thread | `GET/POST /chats/:id/messages`, `POST /chats` |
| Time off / vacation | `GET/POST /vacations`, `DELETE /vacations/:id` |

## Wallet / payouts

| Figma page / screen | API(s) |
| --- | --- |
| Wallet / Active balance | `GET /wallet`, `GET /wallet/transactions` |
| Earnings analytics chart | `GET /wallet/overview` |
| Withdraw | `POST /wallet/withdraw` |
| Payout request | `GET/POST /payouts` |
| Payment Methods | `GET/POST /payment-methods`, `DELETE /payment-methods/:id` |
| Billing History | `GET /billing-history` |

## Client wellness

| Figma page / screen | API(s) |
| --- | --- |
| Mood check-in | `POST/GET /mood/checkins` |
| Mood detector (camera + consent) | `POST /mood/detector` |
| Journal list / entry | `GET/POST /journals`, `GET/PUT/DELETE /journals/:id` |
| Intake / assessments | `POST /assessments`, `POST /assessments/:id/answers`, `GET /assessments` |
| Goals | `GET/PUT /goals` |
| Find specialists | `GET /specialists`, `GET /specialists/:id` |
| Book session + checkout | `POST /bookings`, `POST /bookings/:id/checkout`, `GET /bookings` |

## Profile / privacy / support

| Figma page / screen | API(s) |
| --- | --- |
| Profile | `GET/PATCH /profile` |
| Notification inbox | `GET /notifications`, mark-read endpoints |
| Notification preferences | `GET/PATCH /notifications/preferences` |
| Devices | `POST/GET /devices`, `DELETE /devices/:id` |
| Privacy consents | `GET/PUT /privacy/consents` |
| Media recordings | `GET/POST /privacy/media`, `DELETE /privacy/media/:id` |
| Data export | `POST /privacy/export`, `GET /privacy/exports` |
| Retention policy | `GET /privacy/retention` |
| FAQ | `GET /faqs?locale=en\|ar` |
| Platform Policies | `GET /policies`, `GET /policies/:slug` |
| Contact Us | `POST /contact` |
| Report a Problem | `POST /report-problem` |

Arabic screens use the same APIs; pass `locale=ar` or set user locale via `/settings` / `/profile`.

## Demo accounts (after `npm run db:setup`)

- Therapist: `demo@nafs.app` / `Password123!`
- Client: `client@nafs.app` / `Password123!`
