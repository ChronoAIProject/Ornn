---
"ornn-api": minor
"ornn-web": minor
---

Skill & skillset permission levels (read / read-write) and ownership transfer.

Skills and skillsets now carry a typed `grants` ACL where each user/org grant has a level: **read** (view / pull / execute) or **read-write** (also update the skill's content & metadata). Read-write grantees cannot manage permissions, transfer ownership, or delete — those admin/danger-zone actions stay with the owner and platform admins only.

Owners (and platform admins) can **transfer a skill or skillset to another Ornn user** from the Danger Zone; the transfer is immediate and the prior owner keeps read access. All existing shares (public, org, and per-user) migrate to read-only with no disruption to current access.
