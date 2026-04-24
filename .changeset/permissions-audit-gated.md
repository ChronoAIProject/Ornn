---
"ornn-api": minor
"ornn-web": minor
---

feat: audit-gated permissions save — when a skill owner adds a new user / org grant or flips a skill to public in the PermissionsModal, each added target now routes through `POST /api/v1/skills/:idOrName/share` instead of the direct `PUT /permissions` path, so the audit engine runs before access is granted. Removes and flip-to-private continue to be applied immediately. Adds a new owner-facing `POST /api/v1/skills/:idOrName/audit` so owners can also pre-flight an audit from the AuditBanner; the admin `POST /admin/skills/:idOrName/audit` endpoint stays for any-skill admin reach.
