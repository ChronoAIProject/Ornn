---
"ornn-api": minor
---

Skills can now be pulled from public GitHub repos. `POST /api/v1/skills/pull` accepts `{ repo: "owner/name", ref?, path? }`, fetches the target directory via the GitHub contents API, builds a ZIP, validates, and publishes. `POST /api/v1/skills/:id/refresh` re-pulls the stored source and publishes as a new version. Skill docs carry an optional `source` field (type `github`, with repo/ref/path/lastSyncedAt/lastSyncedCommit) that's returned on `GET /api/v1/skills/:id` when present. Closes #57.
