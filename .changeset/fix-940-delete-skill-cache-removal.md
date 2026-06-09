---
"ornn-web": patch
---

Deleting a skill now removes its detail/versions cache (predicate covers name- and guid-keyed entries) so the page no longer refetches the deleted skill → 404 (#940)
