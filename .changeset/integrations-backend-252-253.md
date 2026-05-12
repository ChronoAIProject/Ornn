---
"ornn-api": minor
---

Backend integrations for Go-Live: PostHog analytics (#252) and AgentSeal trust scanner (#253).

- **#252 — PostHog server-side analytics.** New `infra/analytics` module wraps `posthog-node` behind an `AnalyticsTracker` interface (Noop sink when `POSTHOG_API_KEY` is unset). High-level emitter exposes `trackSkillPull` (with `callerType` + `skillId`), `trackSkillPublished`, and `trackApiError` (sampled at `POSTHOG_ERROR_SAMPLE_RATE`). Wired into the skill detail/json routes, the `createSkill` and `updateSkill` publish paths, and the global `app.onError` handler. Pino logging on every emission, with property-key lists at `info` and full bodies only at `debug` so we never leak PII.
- **#253 — AgentSeal subprocess scanner.** New `infra/agentseal` module spawns `agentseal guard --output json` per skill version publish (and first-create) with a configurable timeout (`AGENTSEAL_TIMEOUT_MS`, default 60s). Scan record persisted on `skillVersion.agentsealScan = { score, findings, scannedAt, agentsealVersion }`, with a sparse Mongo index on `agentsealScan.score` for admin queries. v1 is warn-only — failures are logged but never block publish. New admin endpoint `POST /admin/skills/:idOrName/versions/:version/agentseal-rescan` to manually re-trigger a scan. AgentSeal Python package baked into `ornn-api/Dockerfile` (pinned `agentseal==0.5.0` via a `/opt/agentseal` venv).
