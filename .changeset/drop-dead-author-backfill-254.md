---
"ornn-api": patch
---

Delete the dead `backfill-skill-author-display-names.ts` migration script (#254).

The script joined `skills.createdBy` against an `activities` collection to retro-populate `createdByEmail` / `createdByDisplayName` on legacy skill rows. Both prerequisites are gone:

- New skills cache the author labels at create time (no backfill needed for any post-#239 row).
- The `activities` collection was retired in #271 (PostHog took over the audit pipeline) — no source-side reference to it remains in `ornn-api/src`. The script would read from an empty / nonexistent collection on any current deployment.

The bug #254 originally reported (`$last` in an unsorted aggregation picking arbitrary rows) is moot for a script that can't run usefully anyway. Cleaner to delete than to fix code that's known dead. Also removes the companion test file.

If a future deployment unearths a database still carrying `activities`, the right cleanup is a fresh one-shot migration scoped to that database, not resurrecting this script.
