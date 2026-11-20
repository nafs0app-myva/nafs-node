# Exercise media

API responses include absolute `audio_url` / `video_url` / `media_url` fields.

## Admin uploads (preferred)

Sign in at https://myva.ae/admin/ → **Exercises**.

- Create or open an exercise
- Upload **video**, **audio**, and/or **thumbnail**
- Files are stored under `uploads/{exercise_id}/` and served at
  `/media/exercises/uploads/...`

Limits: video 200 MB · audio 50 MB · thumbnail 5 MB.

## Env fallbacks (optional)

If an exercise still uses sample hosts, you can also set:

- `MEDIA_AUDIO_BASE_URL`
- `MEDIA_VIDEO_BASE_URL`
- `MEDIA_THUMB_BASE_URL` (defaults to `{APP_URL}/media/exercises`)

Thumbnail JPGs in this folder are placeholders until replaced via the admin panel.
