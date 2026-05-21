---
"ornn-web": patch
---

Free / ZIP upload no longer shows contradictory "structure is valid" on backend reject (#652).

When the frontend validator flagged a ZIP as `invalid`, the user could flip `Skip validation` and submit anyway. The backend then rejected (e.g. `SKILL.md not found in package`), the rejection toast fired — but the page banner unconditionally fell back to `valid` and rendered "Skill package structure is valid." on top of the toast.

`CreateSkillFreePage` now restores `pageState` to the original `validationResult.status` after a failed submit (`invalid` stays `invalid`, `warning` stays `warning`, `valid` stays `valid`). The success banner can never appear on a structure the frontend itself flagged as bad.
