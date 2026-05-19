---
"ornn-api": patch
---

Replace `_id: guid as any` with `skillId(guid)` / `skillIdList(guids)` helpers in `domains/skills/crud/repository.ts` (#448). The skills collection uses UUID strings as `_id`; the MongoDB driver's filter discriminator (`ObjectId | string`) doesn't see that without help, and the previous `as any` propagated unchecked through every query. The new helpers validate non-empty strings up front (the bad-input path that previously silently returned zero docs) and keep the unavoidable cast in one named place. Seven call sites migrated.
