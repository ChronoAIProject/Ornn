---
"ornn-api": patch
---

fix(api): admin user list + permissions-modal user resolve — pick latest **non-empty** email/displayName from activities, not the literal latest row.

The aggregator's `$last: "$userEmail"` and `$last: "$userDisplayName"` surfaced whatever the most recent activity row carried — even empty strings — so users whose most recent activity was authenticated by a JWT lacking `email` / `name` claims (some admin / proxy / SA-flavored login paths emit those empty) showed up blank in the admin user list and the permissions-modal user chips, even though earlier activities had the labels populated. Sorts the group desc-by-createdAt, `$push`'s the values, then picks the first non-empty per field downstream.

Also adds `scripts/backfill-skill-author-display-names.ts` to retro-populate `createdByEmail` + `createdByDisplayName` on existing skill docs by joining `skills.createdBy` against the activities directory — older skills predate the cache-at-create-time behavior so the Skill Detail / Skill Card UI was rendering the raw user_id UUID.
