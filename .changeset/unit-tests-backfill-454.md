---
"ornn-api": patch
---

Backfill repository-layer unit tests for 6 previously untested domains (#454).

Adds `repository.test.ts` against `mongodb-memory-server` for: `users`, `platform`, `analytics`, `notifications`, `announcements`, `redemption-codes`. Plus `platform/service.test.ts` to pin the encryption boundary (`apiKey` is plaintext above the service, ciphertext below) and the graceful-degrade path when decryption fails. Each new file covers happy path + at least one edge per public method per the #454 acceptance criteria.

Highlights of what's now pinned in tests:

- `UserDirectoryRepository`: idempotent upsert preserves `firstSeenAt` while bumping `activityCount`/`lastSeenAt`; `searchByEmailPrefix` escapes regex metacharacters; `listUsers` role partition + pagination.
- `PlatformSettingsRepository`: empty doc returns `{}` so the service-layer merge can tell "unset" from "zero"; partial patches don't clobber untouched fields; wrong-type values are skipped gracefully.
- `PlatformSettingsService`: `apiKey` round-trips through encryption but never appears in plaintext in Mongo; malformed v1 ciphertext returns `""` (graceful degrade) instead of throwing; legacy pre-encryption rows pass through; 30-s cache is busted by `patch`.
- `AnalyticsRepository`: latency is rounded to int + clamped to 0 on negatives; `summarize` window aggregates execution/success/failure/timeout counts + unique-users + success rate; per-version narrowing works.
- `NotificationRepository`: per-user ownership is enforced on `markRead` (user A cannot read user B's notification); `unreadOnly` + `before` filters; `markAllRead` reports modifiedCount.
- `AnnouncementRepository`: `findActive` honors `[startsAt, endsAt]` window + disabled gate; `findAllReleased` retains expired records (News archive); legacy single-locale rows backfill `*En`/`*Zh` slots so reads stay live during the bilingual migration window.
- `RedemptionCodeRepository`: `tryClaimForRedeem` is atomic — concurrent attempts yield exactly one winner; expired/invalidated codes can't be redeemed; `list` search escapes regex metacharacters (no ReDoS, no false positives).

Net +81 tests, +1 file (no source changes — pure test backfill).
