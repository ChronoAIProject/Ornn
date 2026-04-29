---
"ornn-api": patch
---

fix(api): `POST /api/v1/skill-format/validate` now returns every rule violation in the package, not just the first one that throws. Previously the route was discarding the array `validateZipFormat` returned and only catching thrown errors, so packages whose violations were collected (rather than thrown) came back as `valid: true` even when the upload path would later reject them. Response on failure is now `{ data: { valid: false, violations: [{ rule, message }, ...] } }` covering every fired rule, so a calling agent / SDK can fix every problem in one round-trip. Three integration tests added (valid case, single YAML-parse violation, multiple independent violations).
