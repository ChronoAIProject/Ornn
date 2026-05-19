---
"ornn-api": minor
"ornn-web": patch
---

**BREAKING:** every error `code` emitted by `/api/v1/*` is now `lowercase_snake_case` per CONVENTIONS.md §1.4 (#585). `SKILL_NOT_FOUND` → `skill_not_found`, `INVALID_BODY` → `invalid_body`, `FORBIDDEN` → `forbidden`, etc. One-for-one lowercase translation: every existing code keeps its specificity, the parent §1.4 catalog (`validation_error`, `permission_denied`, `resource_not_found`, …) is the taxonomy these subcodes hang under. Clients pinned to the old strings need to switch — `docs/ERRORS.md` ships the full migration map.

Web call sites that branch on specific codes (`AGENTSEAL_DISABLED`, `OLD_REPO_NOT_CONFIRMED`, `AUDIT_NOT_FOUND`) migrated to the lowercase equivalents in the same PR. No code-aware logic in the published SDK code paths today, so SDK consumers only need to update their own catch-by-code handlers.
