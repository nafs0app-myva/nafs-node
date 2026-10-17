# Nafs Therapist API (from Figma)

Base URL: `/api/v1`  
Auth: `Authorization: Bearer <jwt>`  
Demo: `demo@nafs.app` / `Password123!`

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

## Wallet / Billing
| Method | Path |
| --- | --- |
| GET | `/wallet` |
| GET | `/wallet/transactions` |
| GET | `/wallet/overview` |
| POST | `/wallet/withdraw` |
| GET/POST | `/payment-methods` |
| GET | `/billing-history` |

## Chat
| Method | Path |
| --- | --- |
| GET/POST | `/chats` |
| GET | `/chats/:id/messages` |
| POST | `/chats/:id/messages` |

## Profile / Support
| Method | Path |
| --- | --- |
| GET/PATCH | `/profile` |
| GET | `/faqs` |
| GET | `/policies`, `/policies/:slug` |
| POST | `/contact` |
| POST | `/report-problem` |
| GET | `/notifications` |
| POST | `/devices` |
