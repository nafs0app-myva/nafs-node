# Nafs API reference

Base URL: `/api/v1`  
Auth header: `Authorization: Bearer <jwt>`

## Auth

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| POST | `/auth/register` | no | `email`, `password`, `full_name`, optional `phone`, `gender`, `timezone`, `locale` |
| POST | `/auth/login` | no | `email`, `password` |
| POST | `/auth/verify-email` | no | `email`, `code` |
| POST | `/auth/forgot-password` | no | `email` |
| POST | `/auth/reset-password` | no | `email`, `code`, `password` |
| GET | `/auth/me` | yes | — |

## Product flows

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/onboarding/steps` | Public carousel screens |
| POST | `/onboarding/complete` | Saves goals/location/madhab |
| GET | `/home/dashboard` | Today’s prayers, habits, tip, challenge |
| GET/PATCH | `/profile` | User + profile |
| POST | `/prayers/log` | Upsert salah for a date |
| GET | `/prayers/day?date=` | Day view |
| GET | `/prayers/calendar?month=YYYY-MM` | Month grid |
| GET | `/dhikr/presets` | Counter templates |
| POST | `/dhikr/sessions` | Start session |
| POST | `/dhikr/sessions/:id/tick` | Increment counter |
| CRUD | `/journals` | Mood journal |
| POST/GET | `/habits` | Habit list |
| POST | `/habits/:id/log` | Check-in |
| GET | `/habits/:id/streak` | Current streak |
| GET | `/challenges` | Catalog |
| POST | `/challenges/:id/join` | Enroll |
| GET | `/me/challenges` | My enrollments |
| POST | `/me/challenges/:id/tasks/:taskId/complete` | Complete task |
| GET/PUT | `/quran/progress` | Last read position |
| POST/GET | `/quran/reflections` | Reflections |
| POST | `/fasting/log` | Fast day upsert |
| GET | `/fasting` | Fast history |
| GET | `/content`, `/content/daily` | Ayah/dua/tips |
| GET | `/notifications` | Inbox |
| POST | `/devices` | Push token |

Response shape:

```json
{ "success": true, "message": "OK", "data": {} }
```
