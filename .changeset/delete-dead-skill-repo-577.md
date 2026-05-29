---
"ornn-api": patch
---

Delete dead `domains/skills/crud/repositories/` subdirectory (#577) — a 218-line `SkillRepository` impl + interface + test that no route, service, or test outside the directory itself imported. The live skill repository (915 lines) lives at `domains/skills/crud/repository.ts` and is unaffected.
