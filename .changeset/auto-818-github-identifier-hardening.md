---
"ornn-api": patch
---

Harden GitHub identifier validation: mirror settings owner/repo now enforce the same naming rules as the mirror routes (shared constants), and repo pull identifiers reject "." / ".." path-traversal segments.
