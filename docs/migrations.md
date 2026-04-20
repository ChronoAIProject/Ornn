# Data migrations

Operational notes for data migrations that accompany specific features. Scripts live under `ornn-api/scripts/` and are wired into `ornn-api/package.json`.

## `migrate:versions` — Skill versioning foundation

For every existing skill that pre-dates the versioning feature, patches its `SKILL.md` frontmatter to carry a top-level `version` field and republishes through the API so the full versioning machinery (storage upload, hash recompute, `skill_versions` row insert, `latestVersion` pointer) runs through the same code path a normal publish uses.

### Why HTTP instead of direct DB + storage

The storage service hands out presigned URLs pointing at an internal MinIO hostname that isn't reachable from outside the cluster. Going through the API avoids that entirely — the script can run from any host with network access to `ornn-api` and an admin access token.

### Flow per skill

1. `GET /api/skills/:guid/versions` — if the list is non-empty the skill already has at least one version row and we skip.
2. `GET /api/skills/:guid/json` — returns the unpacked package (SKILL.md body + every scripts/ / references/ / assets/ file).
3. Patch `SKILL.md`: insert a top-level `version: "<resolved>"` line if missing, or rewrite an existing `version:` line to the canonical quoted form. Resolution order for the version string: `skill.latestVersion` → `skill.metadata.version` → `"0.1"`.
4. Re-pack into a ZIP wrapped in a `<skill-name>/` root folder (matches the validator's expectations).
5. `PUT /api/skills/:guid?skip_validation=true` — the API's update flow inserts the `skill_versions` row, advances the skill doc's `latestVersion`, and writes the new storage key + hash. `skip_validation` is on because some legacy skills pre-date current schema requirements beyond just the version field.

Idempotent: skills with an existing version row are skipped on re-run.

```bash
# From the repo root.
cd ornn-api
MONGODB_URI=... MONGODB_DB=... \
ORNN_API_URL=http://localhost:3802 \
ORNN_ADMIN_TOKEN=<NyxID access token with ornn:admin:skill> \
bun run migrate:versions
```

Expected end-of-run summary:

```
Skill versions migration complete:
  scanned=N
  migrated=M
  alreadyMigrated=K
  missingSkillMd=Z
```

On a fresh deploy `migrated == scanned`. On re-runs `alreadyMigrated == scanned`. Any per-skill errors are listed at the end and the process exits non-zero so the run fails loudly.
