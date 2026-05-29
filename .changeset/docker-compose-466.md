---
"ornn-api": patch
"ornn-web": patch
---

Ship a `docker-compose.yml` for one-command local dev (#466). Brings up MongoDB, MinIO, `ornn-api`, and `ornn-web` in a single `docker compose up`. README's new "Run Ornn locally (5 minutes)" section and `CONTRIBUTING.md`'s rewritten "Getting set up" tier the prerequisites by what each contributor actually needs:

- **Unit tests / lint / typecheck:** just Bun + Docker.
- **Running the services:** `docker compose up`.
- **Full integration with NyxID / chrono-storage / chrono-sandbox / opensandbox:** the existing K8s manifests under `deployment/`.

NyxID stays out of compose deliberately — mocking the OAuth + JWT-signing path is non-trivial and would either ship a fake or pin to a real staging. Public endpoints (`/livez`, `/api/v1/skill-format/rules`, `/api/v1/skill-manifest-schema.json`, OpenAPI spec) work without auth, which is enough for most contributor flows. Auth-required endpoints need `NYXID_BASE_URL` pointed at your own NyxID instance — same model the existing `deployment/.env.ornn` uses.

Includes a sample `.env.compose.sample` with the only knob a contributor typically overrides (`ENCRYPTION_KEY`).
