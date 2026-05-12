---
"ornn-api": minor
"ornn-web": minor
---

PostHog-only platform analytics + audit. Closes #271.

Replaces every custom audit / activity surface in Ornn with the
PostHog SDK as the single source of truth. The OpenTelemetry
placeholder section was dropped — Ornn does not run an OTel pipeline.

**`ornn-api` — added.** New per-request `apiRequestTracking`
middleware on `/api/v1/*` emits an `api.request` PostHog event for
every authenticated request with `userId`, `callerType` (web / api /
system / playground), `method`, `path`, `routePattern`, `status`,
`durationMs`, `sourceIp` (truncated /24 IPv4, /48 IPv6 before emit),
and `requestId`. New typed `analyticsEmitter.trackPlatformActivity`
helper covers every domain action that previously lived in the
`activities` Mongo collection — login / logout, skill CRUD + version
delete + visibility / permissions changes, source link / unlink,
NyxID service tie, AgentSeal rescan, settings export / import. PostHog
config now reads from the `telemetry` admin settings section at boot
(env vars are bootstrap fallback); a non-empty `postHogApiKey` in the
DB makes the whole record authoritative.

**`ornn-api` — removed.** Universal API audit middleware (#245):
`middleware/audit/*`, `ApiAuditRepository`, `AuditBodyStorage`,
`api_audit` Mongo collection, audit MinIO bucket usage, env vars
`AUDIT_RETENTION_DAYS` / `MINIO_AUDIT_BUCKET` /
`AUDIT_BODY_INLINE_MAX_KB` / `AUDIT_GLOBAL_REDACT_PATTERNS`.
`ActivityRepository` and the `activities` collection. Endpoints
`/admin/activities` and `/admin/stats` (legacy). OpenTelemetry fields
on the telemetry settings section schema. The `users_meta` backfill
in the quota migration script.

**`ornn-api` — refactored.** `AdminUsersRepository` and
`UsersMetaRepository` collapsed into a single
`UserDirectoryRepository` (collection: `users`) — the typeahead,
admin user list, and dashboard role partition were derived from
`activities` aggregations and needed a different home now that the
audit log is gone. Lazy upsert from `proxyAuthSetup.onAuthSeen` on
every authenticated request stamps `firstSeenAt`, refreshes
`lastSeenAt`, increments `activityCount`, and updates `isAdmin`. NyxID
remains authoritative for permission checks; this collection is a
display + indexing cache.

**`ornn-web` — added.** Active `TelemetrySection` replaces the OTel +
PostHog placeholder. Admin-editable PostHog enabled flag, API key
(encrypted at rest), host, project ID, and error sample rate; saves
trigger an explicit "restart required" notice. New `lib/postHogLinks`
helper computes the dashboard URL from the ingest host (`eu.i.posthog.com`
→ `eu.posthog.com`).

**`ornn-web` — removed.** Activity-feed UI (`ActivitiesPage`) and the
`RecentActivities` dashboard widget — both replaced with deep-links
to the PostHog Activity / Insights views. `fetchRecentActivities` and
the `RecentActivity` type from `services/adminDashboardApi`.

**Tradeoffs accepted.** No request/response body archive. Audit
retention = PostHog retention. PostHog SaaS dependency (long outages
drop events). No distributed tracing — OTel deferred to a future
issue with a real backend.

**Operator notes.** New env: `POSTHOG_ENABLED` (bootstrap fallback;
admin telemetry section overrides). Operators with existing
`api_audit` / `activities` / `admin_users` / `users_meta` Mongo
collections + an `ornn-audit` MinIO bucket can drop them at their
convenience — Ornn no longer reads or writes any of them. Audit
trail post-deploy lives in the configured PostHog project.
