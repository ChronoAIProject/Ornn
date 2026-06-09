---
"ornn-web": patch
---

Fix version delete/deprecation 404 when Skill Detail is opened by name: the GUID-only version-write routes now always receive the skill GUID on the wire while cache invalidation stays keyed on idOrName (#750)
