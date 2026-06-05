---
"ornn-api": patch
---

setSkillPermissions now distinguishes an unresolved org-membership read (forwarded token absent or NyxID unreachable) from a confirmed non-membership: sharing a skill into an org while memberships are unresolved returns a retryable 503 org_membership_unavailable instead of a misleading 403 not_org_member. Confirmed non-members still get 403. Read-path visibility is unchanged (still fail-soft).
