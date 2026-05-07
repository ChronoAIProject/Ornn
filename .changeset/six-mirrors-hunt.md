---
"ornn-api": minor
"ornn-web": minor
---

chore: delete admin Categories / Tags / Auditing / Activities pages (#292).

Four admin pages with no real workflow gone:

- **Categories** — admin CRUD over the four-name fixed enum (`plain`, `tool-based`, `runtime-based`, `mixed`) was operator surface area for nothing. Skill metadata's `category` field stays; the values become effectively immutable, matching how the system already worked in practice.
- **Tags** — same shape. Predefined-tag list editor goes; skill upload still emits user-typed custom tags.
- **Auditing** — pure "Coming soon" placeholder, no backend. Per-skill audit history at `/skills/:idOrName/audits` is a different surface and stays.
- **Activities** — redirect-shim to PostHog. Dashboard's `<RecentActivities />` already renders `postHogActivityUrl()`, so the dedicated page was exactly redundant.

Backend admin endpoints (`/api/v1/admin/categories/*`, `/api/v1/admin/tags/*`) deleted along with `AdminService` + `CategoryRepository` + `TagRepository` (admin-page-only consumers — no other caller). Frontend hooks/services/types wound down to empty stubs (kept as obvious homes for future admin-only frontend code).

Ships across 7 commits — one page per commit, one for the backend, one for an orphan test file. Backend 477/477, frontend 50/50, typecheck clean both sides.
