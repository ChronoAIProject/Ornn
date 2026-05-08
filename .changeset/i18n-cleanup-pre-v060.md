---
"ornn-web": patch
---

Pre-v0.6.0 i18n cleanup:

- Drop workshop / forge / 工坊 brand voice from four keys still using it after the recent positioning change. New copy aligns with "the end-to-end skill life-cycle manager for AI agents":
  - `login.tagline` — "Skill life-cycle for AI agents" / "面向 AI 代理的技能生命周期平台"
  - `notFound.goHome` — "Return to home" / "返回首页"
  - `landing.footer.tagline` — drops the "From the Chrono AI workshop" tail
  - `contact.headlineHighlight` — "team" / "我们"
- t()-ify `ServiceDetailPage` end-to-end. New `serviceDetail` i18n section covers status badges, action button, error/empty states, back nav, and all card headings.
- t()-ify the three hardcoded strings in `AnnouncementsPage` empty state.

Closes #339.
