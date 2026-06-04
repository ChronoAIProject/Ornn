---
"ornn-api": patch
---

Reject path-traversal skill names on the `skip_validation` import path. The lenient frontmatter extractor now enforces the same kebab-case name rule as the strict path, and the GitHub-mirror folder builder refuses unsafe names, preventing a crafted skill name from writing outside its own folder in the public mirror.
