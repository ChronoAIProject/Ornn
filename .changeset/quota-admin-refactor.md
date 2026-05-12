---
"ornn-api": minor
"ornn-web": minor
---

Quota redefinition + admin panel restructure.

- **Quota model**: replaced daily-ceiling + time-period grant ledger with calendar-month buckets. New `quota_buckets` collection, atomic `findOneAndUpdate $inc`, no carry-over, grants apply to the current month only. Admins (`ornn:admin:skill`) continue to bypass.
- **Breaking** — `GET /api/v1/me/quota` payload drops the `daily` block. Each surface now exposes `defaultAllotment`, `adminGrant`, `used`, `remaining`, `warningThreshold`, `warning`, plus top-level `monthMarker`, `monthStart`, `monthEnd`, `nextMonthlyResetAt`. ornn-web is the only known consumer and is updated in lockstep.
- **Breaking** — `POST /api/v1/admin/quota/grant` and `/grant/bulk` no longer accept `periodMonths`. Grants are additive to the current-month bucket and disappear at month rollover.
- **New endpoints** — `/admin/quota/users?surface=` (per-user current-month rows), `/admin/quota/users/:id/lifetime?surface=` (per-month history with `usedByModel` breakdown), `/admin/dashboard/stats`, `/admin/dashboard/recent-activities`, `/admin/users?role=admin|normal&page&pageSize&q&sort&dir`.
- **Settings umbrella** — admin settings split into nine per-section docs (LLM providers, playground, skill generation, mirror, NyxID, services, skill audit, telemetry, quota defaults, extras) with sentinel-redacted export/import.
- **Hardcode parameterization** — runtime knobs (LLM gateway, default model, storage/sandbox URLs, NyxID base URL, AgentSeal toggle/timeout, SSE keep-alive, extra NyxID services) moved from env to admin settings.
- **Migration** — `ornn-api/scripts/migrate-quota-to-buckets.ts` converts old `user_quotas` + `quota_grants` into the new shape, archives the legacy ledger to `_archive_quota_grants` with a 90-day TTL, backfills `users_meta.firstJoinedAt` from `MIN(activities.createdAt)`, and notifies users with multi-month grants per Story 10.3. Idempotent; supports `--dry-run`.
