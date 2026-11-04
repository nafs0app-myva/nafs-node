# Exercise media

API responses include absolute `audio_url` / `video_url` / `media_url` fields.

Default audio/video streams point at public sample hosts so the player works
immediately. To use your own CDN files, set:

- `MEDIA_AUDIO_BASE_URL`
- `MEDIA_VIDEO_BASE_URL`
- `MEDIA_THUMB_BASE_URL` (defaults to `{APP_URL}/media/exercises`)

Thumbnail JPGs in this folder are placeholders — replace with real artwork.
