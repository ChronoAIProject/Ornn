# API Reference

The Ornn API reference no longer lives in this repository as a static document. It ships as part of the **`ornn-agent-manual`** system skill, alongside the agent operations manual and error legend.

## Where to find it

- **Source (in this repo):** [`skills/ornn-agent-manual/`](../skills/ornn-agent-manual/) — `SKILL.md` (workflow + recipes) and `references/api-reference.md` (full per-endpoint catalogue + error legend).
- **Pull from a running Ornn instance:**

  ```bash
  nyxid proxy request ornn-api \
    "/api/v1/skills/ornn-agent-manual/json" \
    --method GET --output json
  ```

- **Pin a specific version:**

  ```bash
  nyxid proxy request ornn-api \
    "/api/v1/skills/ornn-agent-manual?version=2.0" \
    --method GET --output json
  ```

- **Auto-generated OpenAPI 3 schema:** `GET /api/v1/openapi.json`. Built from the same Zod schemas the runtime uses for validation, so it never drifts.

## Why this lives as a skill

Ornn's product is "Skill-as-a-Service for AI agents". The API documentation an agent needs to call Ornn is itself an Ornn skill — agents pull it through the same `GET /skills/:name/json` they use for any other skill. This is dogfood, and it gives the manual the same versioning, ACL, and notification properties as any other skill in the registry.

Updating the manual is just bumping `version:` in `skills/ornn-agent-manual/SKILL.md`, re-zipping, and `PUT /api/v1/skills/<id>` to publish a new version.
