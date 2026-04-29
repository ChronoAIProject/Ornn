---
"ornn-web": minor
---

feat(web): surface skill version diff in the UI (#225). The all-versions modal on the skill detail page now has a "Compare versions" button that opens a new `VersionDiffModal`. Two version pickers (defaulted to current ↔ latest) call `GET /api/v1/skills/:idOrName/versions/:from/diff/:to` and the result renders three sections — Modified / Added / Removed — with file paths, byte sizes, and a unified line-level diff for every modified text file via the `diff` npm package. Binary files report their size + hash change without inline content. Same-version compares short-circuit locally so the backend doesn't see them. en + zh translations added.
