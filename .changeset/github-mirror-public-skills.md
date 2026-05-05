---
"ornn-api": minor
"ornn-web": minor
---

feat: auto-mirror public + system skills to GitHub for `npx skills add` compatibility, with per-skill sync state, admin console, and runtime-mutable repo coords (#248).

Every public (`isPrivate: false`) and system (admin-NyxID-service-tied) skill on Ornn now lands as a subdirectory in `ChronoAIProject/ornn-skills` on GitHub the moment it's published. Users install with the community-standard one-liner:

```bash
npx skills add ChronoAIProject/ornn-skills/<skill-name>
```

Identical UX to `npx skills add anthropics/skills/<name>` — no NyxID account, no auth, anonymous git clone. Limited-access skills (private + shared) stay Ornn-only; that's the intentional moat.

Implementation:
- New `domains/skills/mirror/` module with three pieces: `GitHubAppAuth` (RS256 JWT → installation-token mint, with cache), `GitHubMirrorClient` (Trees / Refs / Tags / Blobs / Commits REST wrapper), and `MirrorService` with `publishSkill(guid)` / `removeSkill(name)` / `reconcileAll()` operations.
- Single-commit-per-sync semantics: each successful sync produces one atomic commit + an annotated `sync-<ISO timestamp>` tag — `git tag --list 'sync-*'` is the audit log.
- Fire-and-forget hooks on every skill mutation route (create, version-publish, refresh, package update, deprecation toggle, permissions / visibility change, NyxID-service tie, delete, version-delete). Errors swallowed + logged; the hourly reconcile cron picks up anything dropped.
- New admin route `POST /api/v1/admin/mirror/reconcile` (`ornn:admin:skill`) for manual full-sweep.
- New `scripts/reconcile-mirror.ts` one-shot entry point + `deployment/ornn-api/mirror-cronjob.yaml` k8s `CronJob` (every hour at :17).
- Disabled by default. Set `GITHUB_MIRROR_ENABLED=true` + the four GitHub App credentials (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, plus `GITHUB_MIRROR_REPO_OWNER` / `_NAME` / `_DEFAULT_BRANCH`) in the ornn-api ConfigMap + Secret to flip on. `assertMirrorConfigComplete` validates at boot — misconfigured deployments fail loud, not silently at first publish.
- Added `findAllEligibleForMirror()` to `SkillRepository` mirroring `MirrorService.isEligible` exactly so the privacy predicate lives in one place.

Per-skill sync state + admin console:
- `SkillDocument.mirrorSync` (`{ version, syncedAt, commitSha }`) — stamped after every successful publish/reconcile commit; cleared on un-mirror; surfaced on `SkillDetailResponse` so the frontend can render a "Synced / Lagging / Never synced" chip.
- Self-healing reconcile: every run starts by clearing stale stamps from skills that flipped private (`{ isPrivate: true, mirrorSync: { $exists: true } }`). The cron is the safety net for incremental-hook failures.
- DB-backed runtime mirror coords: `platform_settings` extended with a `githubMirror: { owner, repo, branch }` block. The configmap (`GITHUB_MIRROR_REPO_*`) seeds the defaults; once an admin patches via `POST /api/v1/github/repo`, the DB value wins thereafter. `GitHubMirrorClient` resolves the target on every API call so admin patches propagate without a redeploy. The `GITHUB_MIRROR_ENABLED` kill switch deliberately stays in the configmap — flipping it is an ops decision that should leave a k8s trail, not a one-click in the admin UI.
- New routes:
  - `GET /api/v1/github/repo` — public read; SkillDetailPage uses it to render the install snippet to anonymous viewers.
  - `POST /api/v1/github/repo` (`ornn:admin:skill`) — admin patch with `confirmAbandonOldRepo: true` required when the change would orphan a non-empty mirror; clears all `mirrorSync` stamps on accepted change so audit links don't dangle into the abandoned repo.
  - `GET /api/v1/admin/mirror/status` (`ornn:admin:skill`) — eligible/synced/lagging/never-synced counts, oldest-unsynced timestamp, last-reconcile state.
  - `POST /api/v1/admin/mirror/reconcile` is now fire-and-forget — returns `202` immediately with the run's `startedAt`; admin UI polls the status endpoint until completion.
- Frontend:
  - `MirrorInstallCard` on `SkillDetailPage` — `npx skills add <owner>/<repo>/<name>` with click-to-copy, sync chip (Synced/Lagging/Never synced), GitHub commit + tree links. Hidden for private skills, when feature is off, and during the initial repo-config fetch.
  - New `/admin/mirror` page in the admin sidebar: feature-enabled banner, status header (repo + last reconcile), counts grid (eligible/synced/lagging/never with oldest-unsynced timestamp), manual reconcile button, repo-coords form with abandon-confirm modal that surfaces the stamped-skill count.

Privacy regression test included: a private skill (with or without `sharedWithUsers` / `sharedWithOrgs`) is asserted to NEVER appear in any payload sent to GitHub.
