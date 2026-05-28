---
"ornn-api": minor
---

Launch-promo foundation — admin-driven manual award flow + caller status (#724, PR 1 of 2).

The landing/news page promises that the first 500 Ornn users who star the GitHub repo and sign in receive a redemption code (200 Playground + 200 Skill Generation credits) plus the NyxID invite code, delivered to the Ornn notification inbox within 24 h. This PR lands the foundation that lets an admin honour that promise today, and gives the calling user a way to see their eligibility.

What ships:

- **`launchPromo` settings section** — `enabled`, `repoOwner`, `repoName`, `totalSlots` (default 500), `awardPlayground` / `awardSkillGen` (default 200), `pollIntervalMs`, `codeExpiryDays`, `nyxidInviteCode`. Defaults are conservative (`enabled: false`, empty repo, empty invite code) so the promo stays dormant until an admin explicitly turns it on.
- **`launch_promo_claims` collection + repo** — one doc per awarded user, keyed on `_id = userId` for primary-key idempotency. Fields: `eligibilityRank`, `redemptionCodeId`, `awardedAt`, `awardedBy`, optional `githubLogin`. Index on `awardedAt desc` for admin observability.
- **`LaunchPromoService.awardUser({ userId, awardedBy, githubLogin? })`** — gates on enabled + rank ≤ `totalSlots` + slots remaining + not-already-claimed, mints a redemption code via the existing redemption-codes service (no quota write — user redeems themselves through Settings → Redeem), drops a `launchPromo.codeDelivered` notification containing the code + NyxID invite code, then records the claim. Duplicate-key during insert (race) cleanly resolves to `ALREADY_CLAIMED`. Notification failure is logged but doesn't roll back the claim — the user already has the grant; admins can resend.
- **`LaunchPromoService.getStatusForUser(userId)`** — composes `{ promoEnabled, claimed, rank, totalSlots, slotsRemaining, awardedAt }` for the `/me/launch-promo` endpoint.
- **`UserDirectoryRepository.getRegistrationRank(userId)`** — 1-based ordering by `firstSeenAt asc`. Two queries (PK lookup + filter count), no scan.
- **New `launchPromo.codeDelivered` NotificationCategory.**
- **Routes** — `GET /me/launch-promo`, `POST /admin/launch-promo/award/:userId` (gated on `ornn:admin:skill`), `GET /admin/launch-promo/recent` for observability. Service-layer error sentinels (`PROMO_DISABLED`, `RANK_EXCEEDED`, `SLOTS_EXHAUSTED`, `ALREADY_CLAIMED`, `USER_NOT_FOUND`) map to 400 / 403 / 409 / 404.

What is **deferred to PR 2** (clearly TODO in the design comments):

- GitHub stargazers HTTP client (public API, no auth) + cron loop driven by `pollIntervalMs`.
- NyxID → GitHub-login resolution (currently the manual admin flow doesn't need this; the cron path will once it lands).
- Frontend admin UI for the settings section + "recent awards" panel.
- Frontend caller-side display ("you're in the first N — claim ready / claimed").

Coverage: 12 colocated unit tests on `LaunchPromoService` covering the happy path, every error sentinel, race-on-insert resolving to `ALREADY_CLAIMED`, and notification-failure-does-not-rollback. All green.
