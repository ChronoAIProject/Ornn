---
"ornn-api": patch
---

Fix an authorization gap where the playground could load a private skill's full contents without checking the caller's read access. `getSkillJson` now requires a caller actor and enforces `canReadSkill` for both the `skillId` and `load_skill` paths, so a private skill is only readable by its owner, users/orgs it is shared with, or a platform admin.
