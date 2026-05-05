---
"ornn-api": minor
---

feat: per-user playground & skill-gen quota with admin-granted credits (#250) + admin-curated Chrono LLM model selection (#251) — backend.

#250 ships per-user monthly base + daily ceiling counters per surface (200/50 playground, 20/5 skill-gen), non-expiring admin-granted credit buckets, lazy UTC-marker-based resets, and admin-issued grants (per-user + bulk) with full audit trail. Charge fires on completion: skill errors count, system errors don't. Admins exempt. Over-limit returns 429 with the upsell message. New endpoints: `GET /me/quota`, `GET /admin/quota/users`, `POST /admin/quota/grant`, `POST /admin/quota/grant/bulk`, `GET /admin/quota/grants`.

#251 ships an admin-controlled local `models` collection synced on demand from Chrono LLM via the NyxID proxy (`/api/v1/proxy/s/chrono-llm/models`). New rows default disabled; admin enables per-surface and picks a default. Removed upstream models flagged `archived`. Playground/skill-gen execute paths accept an optional `modelId`, validate against the surface's enabled list, and 503 with a `MODEL_UNAVAILABLE` admin-contact message when no models are enabled. New endpoints: `GET /me/models?surface=`, `GET /admin/models`, `POST /admin/models/refresh`, `PATCH /admin/models/:modelId`.
