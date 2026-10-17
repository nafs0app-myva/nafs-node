# Nafs API (from NAFS-backup Figma)

Base URL: `/api/v1`  
Auth: `Authorization: Bearer <jwt>`  
Demo therapist: `demo@nafs.app` / `Password123!`  
Demo client: `client@nafs.app` / `Password123!`

## Auth
| Method | Path |
| --- | --- |
| POST | `/auth/register` |
| POST | `/auth/login` |
| POST | `/auth/verify-email` |
| POST | `/auth/forgot-password` |
| POST | `/auth/reset-password` |
| POST | `/auth/change-password` |
| GET | `/auth/me` |

## Therapist application (onboarding screens)
| Method | Path |
| --- | --- |
| GET | `/specializations` |
| GET | `/application` |
| GET | `/application/status` |
| PUT | `/application/identity` |
| PUT | `/application/experience` |
| PUT | `/application/admin-tech` |
| POST | `/application/submit` |

## Home / Calendar / Sessions
| Method | Path |
| --- | --- |
| GET | `/home/dashboard` |
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

## Client mood / journal / assessments
| Method | Path |
| --- | --- |
| POST/GET | `/mood/checkins` |
| POST | `/mood/detector` |
| GET/POST | `/journals` |
| GET/PUT/DELETE | `/journals/:id` |
| POST | `/assessments` |
| POST | `/assessments/:id/answers` |
| GET | `/assessments` |
| GET/PUT | `/goals` |

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
| GET/PATCH | `/profile` |
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
