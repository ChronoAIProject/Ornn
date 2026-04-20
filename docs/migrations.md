# Data migrations

Operational notes for data migrations that accompany specific features. Scripts live under `ornn-api/scripts/` and are wired into `ornn-api/package.json`.

## `migrate:versions` — Skill versioning foundation

Backfills the `skill_versions` collection for every existing skill. Required when deploying the skill-versioning feature (Phase 1 of GitHub issue #25) to a database that pre-dates it.

Behaviour:

1. Scans every document in `skills`.
2. Picks a version string: uses `skill.latestVersion` when valid, else `skill.metadata.version`, else defaults to `0.1`.
3. If a row already exists in `skill_versions` for that `(skillGuid, version)`, skips.
4. Otherwise inserts a row pointing at the skill's current `storageKey` — the legacy package stays reachable through the versioned read path without re-uploading.
5. Backfills `latestVersion` on the skill document when absent or malformed.

Idempotent. Re-running on an already-migrated database makes no changes.

```bash
# From the repo root, in a shell with MONGODB_URI/MONGODB_DB set the same way
# the API runs.
cd ornn-api
bun run migrate:versions
```

Expected end-of-run line:

```
Skill versions migration complete — scanned=N, inserted=M, skipped=K, backfilledLatestVersion=L
```

On a fresh deploy `inserted == scanned`; on re-runs `skipped == scanned`.
