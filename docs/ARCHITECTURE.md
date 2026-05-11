# Architecture — chrono-ornn

> For API v1 and architecture conventions, see [`conventions.md`](./conventions.md). Active refactor work is tracked under the [`Refactor` milestone](https://github.com/ChronoAIProject/Ornn/milestone/6).

## Project Overview

chrono-ornn is an AI skill platform. Users create, publish, search, and execute AI skills (packaged prompts + scripts) via a web UI or API. Authentication and LLM calls go through NyxID. Script execution runs in chrono-sandbox.

## External Services

| Service | How ornn-api talks to it |
|---------|---------------------------|
| NyxID | JWT verification (JWKS), API key introspection, LLM Gateway (Responses API) |
| chrono-sandbox | `POST /execute` — script execution with env vars, dependencies, file retrieval |
| chrono-storage | Upload/download/delete skill packages (presigned URLs) |

## Skill Format

- Available runtimes: `node`, `python`
- Frontmatter field for dependencies: `runtime-dependency`
- Category types: `plain`, `tool-based`, `runtime-based`, `mixed`
- Output types: `text` (stdout), `file` (generated files retrieved via glob)

## Audit + analytics (PostHog)

Issue #271 collapsed every observability surface in Ornn — the
universal API audit middleware (#245), the `activities` Mongo
collection, and the OpenTelemetry placeholder section — into a single
PostHog-driven pipeline. There is **no custom audit code** in Ornn
anymore; everything flows through the `posthog-node` SDK and is
viewed in the PostHog dashboard.

### Event taxonomy

Backend events (server-emitted, every event carries `source: "api"`
so dashboards can disambiguate from frontend events of the same name):

| event | when | properties |
|---|---|---|
| `api.request` | every authenticated `/api/v1/*` request | `userId`, `callerType`, `method`, `path`, `routePattern`, `status`, `durationMs`, `sourceIp` (truncated /24 IPv4, /48 IPv6), `requestId` |
| `api.error` | sampled 5xx responses | `statusCode`, `errorCode`, `method`, `path`, `requestId` |
| `api.skill.pull` | every skill package materialization | `callerType`, `skillId`, `skillName`, `skillVersion` |
| `api.skill.published` | skill create + version publish | `skillId`, `skillVersion`, `isNewSkill` |
| `user.login` / `user.logout` | session open / close | — |
| `skill.created` / `.updated` / `.deleted` / `.version_deleted` | mutation routes | `skillId`, `skillName`, `version`, `adminAction?` |
| `skill.visibility_changed` / `.permissions_changed` | visibility + sharing flips | `skillId`, `isPrivate`, `sharedWithUsers`, `sharedWithOrgs` |
| `skill.refresh` / `.source_linked` / `.source_unlinked` | source-pointer ops | `skillId`, `repo`, `ref`, `commit` |
| `skill.nyxid_service_tied` / `.agentseal_rescanned` | tie + admin-rescan | `skillId`, `isSystemSkill`, `score` |
| `settings.exported` / `.imported` | settings IO | `schemaVersion`, `aggregateStatus`, `dryRun`, `sections` |

Frontend events (browser SDK — `ornn-web/src/lib/analytics.ts`) carry
auto-pageview + cookie-consent state and the typed event union in
that file. Identity is set via `posthog.identify(userId, traits)` on
every NyxID login.

### Caller-type detection

`api.request` is emitted from `apiRequestTrackingMiddleware` mounted
on `/api/v1/*` AFTER `proxyAuthSetup`. `callerType` derives from auth
shape:

| auth shape | `X-Ornn-Caller` | `callerType` |
|---|---|---|
| browser session (NyxID OAuth cookie / browser-scope Bearer) | — | `web` |
| NyxID forwarded user-access token (agent via NyxID proxy) | — | `api` |
| anonymous | `system` / `playground` | matches header |
| anonymous | other | `web` |

The header is informational only. Source IP is read from
`X-Forwarded-For` (first hop), falls back to `X-Real-IP`, then
truncated to /24 (IPv4) or /48 (IPv6) before emit.

### Configuration

PostHog config lives in the admin `telemetry` settings section.
Backend reads it once at boot (`bootstrap.ts`) and falls back to env
vars when the DB section has no API key set:

| field | env fallback | meaning |
|---|---|---|
| `postHogEnabled` | `POSTHOG_ENABLED` | master switch — off forces NoopTracker even with a key |
| `postHogApiKey` | `POSTHOG_API_KEY` | public project key (`phc_…`); empty disables |
| `postHogHost` | `POSTHOG_HOST` | ingest host (e.g. `https://eu.i.posthog.com`) |
| `postHogProjectId` | `POSTHOG_PROJECT_ID` | informational, surfaced in log lines |
| `postHogErrorSampleRate` | `POSTHOG_ERROR_SAMPLE_RATE` | `[0,1]` sampling for `api.error` |

Admin DB is canonical: a non-empty `postHogApiKey` in the section
makes the entire DB record authoritative; otherwise env wins.
Restart-required for changes to apply (the SDK is initialized once
at boot).

### Failure modes accepted

- **No body archive.** Request/response bodies are not captured.
  Forensic body-replay post-incident is not possible. The previous
  MinIO-offload pipeline (#245) was removed.
- **Audit retention = PostHog retention.** Cloud free tier is
  approximately 1 year of events; paid extends. Self-hosted PostHog
  retains as long as the storage volume allows.
- **PostHog-side outages** drop events that miss the in-process
  buffer. The drain on `shutdown()` flushes the buffer; sigterm
  during a backlog can lose tail events.

### Viewing data

There is **no in-Ornn activity feed UI**. Admins use the PostHog
dashboard for the full event explorer, funnels, retention, and SQL
queries. The Ornn admin dashboard at `/admin` deep-links to the
PostHog Activity / Insights views via
`ornn-web/src/lib/postHogLinks.ts`, which translates the configured
ingest host (`<region>.i.posthog.com`) into the matching dashboard
host (`<region>.posthog.com`).

### What about OpenTelemetry?

Considered and deferred (issue #271 discussion). For Ornn's current
single-service architecture and the requirements covered here
(per-request audit, user activity, who-called-what), PostHog alone
is sufficient. OpenTelemetry's value (distributed tracing, metrics
histograms) doesn't justify standing up a collector + Tempo / Loki /
Jaeger today. Reopen as a separate issue if/when the architecture
splits across services or a concrete tracing pain point appears.

### User directory

The unified `users` Mongo collection (built in #271, replaces
`activities` + `admin_users` + `users_meta`) is fed lazily by
`proxyAuthSetup.onAuthSeen` on every authenticated request. It is
NOT audit data — it's an identity cache backing the skill-permissions
typeahead, the admin user list, and the dashboard role partition.
NyxID stays authoritative for permission checks; this collection is
display + indexing only. See
`ornn-api/src/domains/users/repository.ts`.
