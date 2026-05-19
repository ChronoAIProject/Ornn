---
"ornn-api": patch
---

Add `maxTimeMS` + ensure indexes on admin skill search (#446). `GET /admin/skills?q=…` ran an escaped `$regex` against `name` and `description` with no time cap and no documented indexes — a crafted partial-match query on a large collection could pin a Mongo node's CPU indefinitely. Adds a 5 s `maxTimeMS` to both `countDocuments` + `find`, and a new `SkillRepository.ensureIndexes()` (wired into bootstrap) that creates `name` (unique), `description`, `createdBy + createdOn`, `createdOn`, and `isPrivate + createdOn` indexes — partial-regex still can't use a btree, but the secondary filters (`createdBy=…`, `isPrivate=…`) and the `createdOn` sort now hit indexes instead of a full collection scan.
