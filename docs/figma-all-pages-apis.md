# All Figma pages → Nafs APIs

Mapped from Nafs-mobile / NAFS backup (English + Arabic).  
Base: `/api/v1`

| Figma page / screen | API(s) |
| --- | --- |
| Splash / language | `GET /app/bootstrap` |
| Login | `POST /auth/login` |
| Register / Sign up | `POST /auth/register` |
| Verify email OTP | `POST /auth/verify-email` |
| Forgot password | `POST /auth/forgot-password` |
| Reset password | `POST /auth/reset-password` |
| Change Password | `POST /auth/change-password` |
| Identity & qualifications | `PUT /application/identity` |
| Experience & specializations | `GET /specializations`, `PUT /application/experience` |
| Administrative & technical | `PUT /application/admin-tech` |
| Application submitted | `POST /application/submit`, `GET /application/status` |
| Home / Consultant dashboard | `GET /home/dashboard` |
| Join video session | `POST /sessions/:id/join` |
| Calendar | `GET /calendar?month=YYYY-MM`, `GET /sessions?date=` |
| Book / manage session | `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/:id/cancel` |
| Availability | `GET/PUT /availability` |
| Session notes | `POST /sessions/:id/notes` |
| Wallet / Active balance | `GET /wallet`, `GET /wallet/transactions` |
| Earnings analytics chart | `GET /wallet/overview` |
| Withdraw / payout | `POST /wallet/withdraw` |
| Payment Methods | `GET/POST /payment-methods`, `DELETE /payment-methods/:id` |
| Billing History | `GET /billing-history` |
| Clients list (+ search) | `GET /clients?q=` |
| Client detail | `GET /clients/:id`, `PATCH /clients/:id` |
| Add client | `POST /clients` |
| Chat list | `GET /chats` |
| Chat thread | `GET/POST /chats/:id/messages`, `POST /chats` |
| Profile | `GET/PATCH /profile` |
| Settings / notifications / language | `GET/PATCH /settings` |
| FAQ | `GET /faqs?locale=en\|ar` |
| Platform Policies | `GET /policies`, `GET /policies/:slug` |
| Contact Us | `POST /contact` |
| Report a Problem | `POST /report-problem` |
| Notifications inbox | `GET /notifications`, mark read endpoints |
| Push device register | `POST /devices` |
| Me / session restore | `GET /auth/me` |

Arabic page uses same APIs; pass `locale=ar` or set user locale via `/settings` / `/profile`.
