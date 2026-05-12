---
"ornn-api": minor
"ornn-web": minor
---

Add a public News page at `/news` listing every released announcement (current + historical), and the public list endpoint that powers it.

- `ornn-api`: new public `GET /api/v1/announcements` endpoint returning `{ items: PublicAnnouncementListItem[] }` — every enabled announcement whose start gate has elapsed, newest first, with a serialized `publishedAt` (`startsAt ?? createdAt`). Past/expired records are intentionally retained: the News page is an archive. The popup-only `/announcements/active` endpoint is unchanged. Added `AnnouncementRepository.findAllReleased` and `AnnouncementService.listPublished` with unit tests.
- `ornn-web`: new `NewsPage` route at `/news` mirroring the ContactPage editorial layout (eyebrow + display headline + impression cards). Each entry shows a locale-aware publish date, Space Grotesk title, sanitized markdown body (same `react-markdown` + `remark-gfm` + `rehype-sanitize` pipeline as the popup), and an optional CTA button. Navbar gets a "News / 动态" item between Docs and Contact; admin mutations now invalidate the public list query alongside the existing popup + admin queries so a just-created announcement shows up on the News page immediately.

Closes #357.
