# All Figma pages → Nafs APIs

Mapped from **NAFS-backup** (`WPOo1LyxhjFJjUY7cAdcMx`) — English + Arabic.  
Base: `/api/v1` · Live OpenAPI **2.2.0+**

## App / auth

| Figma page / screen | API(s) |
| --- | --- |
| Splash / language | `GET /app/bootstrap` |
| Login | `POST /auth/login` |
| Register / Sign up | `POST /auth/register` (emails OTP) |
| Verify email OTP | `POST /auth/verify-email`, `POST /auth/resend-verification` |
| Forgot password | `POST /auth/forgot-password` (emails OTP) |
| Reset password | `POST /auth/reset-password` |
| Change Password | `POST /auth/change-password` |
| Me / session restore | `GET /auth/me` |
| Settings / language | `GET/PATCH /settings` |

## Shared first-run onboarding

| Figma page / screen | API(s) |
| --- | --- |
| Client / therapist setup after signup | `GET/PUT /onboarding` (`completed: true` when finished) |
| Optional intake quizzes | `POST /assessments`, `POST /assessments/:id/answers` |
| Goals | `PUT /goals` and/or `PUT /onboarding` `{ goals }` |

`city` / `preferred_therapist_gender` / `concerns` are optional on `/onboarding` — may be filled later via `PATCH /profile`.

## Therapist application (licensing)

| Figma page / screen | API(s) | Body focus |
| --- | --- | --- |
| Identity & qualifications | `PUT /application/identity` | name, gender, age\|DOB, licenses[], degrees[] |
| Experience & specializations | `GET /specializations`, `PUT /application/experience` | specialization_ids, years_in_specialization\|years_experience |
| Admin (fees + weekly schedule) | `PUT /application/admin-tech` | session_fee_default, slots[] |
| (Same schedule later) | `GET/PUT /availability` | slots[] |
| Application submitted | `POST /application/submit`, `GET /application/status` |

Address / video fields on admin-tech are optional extras (settings / other screen), not required by the Admin fees UI.

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
| Client home | `GET /home/dashboard` (role=`client`: streak, today_tasks, goals, upcoming) |
| Mood check-in | `POST/GET /mood/checkins` |
| Mood detector (camera + consent) | `POST /mood/detector` |
| Journal list / entry | `GET/POST /journals`, `GET/PUT/DELETE /journals/:id` |
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
| FAQ | `GET /faqs` |
| Policies | `GET /policies`, `GET /policies/:slug` |
| Contact us | `POST /contact` |
| Report a problem | `POST /report-problem` |
