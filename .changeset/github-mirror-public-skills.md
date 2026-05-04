---
"ornn-api": minor
---

feat(api): auto-mirror public + system skills to GitHub for `npx skills add` compatibility (#248).

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

Privacy regression test included: a private skill (with or without `sharedWithUsers` / `sharedWithOrgs`) is asserted to NEVER appear in any payload sent to GitHub.
