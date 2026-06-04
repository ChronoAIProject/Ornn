---
"ornn-api": patch
---

Fix CWE-862 (#815): PUT /skills/:id/permissions rejects sharing a skill into an org the caller is not a member of (403 not_org_member); platform admins exempt.
