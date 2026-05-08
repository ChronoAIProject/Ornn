---
"ornn-api": minor
"ornn-web": minor
---

Landing-page announcement popup with admin management. Admins can curate news / changelog blurbs from a new `/admin/announcements` page; the most recent enabled record currently within its `[startsAt, endsAt]` window is shown to every visitor (anonymous + signed-in) on the landing page, dismissible per-id via `localStorage`.

- **API.** New `announcements` Mongo domain. Public `GET /api/v1/announcements/active` (anonymous-friendly) returns the single live record or `null`. Admin CRUD lives under `/api/v1/admin/announcements` gated on `ornn:admin:skill`.
- **Admin UI.** Top-level `/admin/announcements` next to Skills and Quota — list table with LIVE / SCHEDULED / EXPIRED / DISABLED status, per-row enable / edit / delete, and a 560px right-edge drawer for create / edit with a markdown body preview, optional CTA pair, and optional schedule window.
- **Landing.** New `AnnouncementPopup` mounted on `/`. One-shot per id: `localStorage` key `ornn:announcement:dismissed:<id>` keeps the same browser from being re-prompted. CTA links open in a new tab and also mark dismissed on click.

Closes #307.
