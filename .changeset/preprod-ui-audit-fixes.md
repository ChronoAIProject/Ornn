---
"ornn-web": patch
---

fix(web): pre-production UI audit fixes (#283).

- **CookieConsentBanner** — anchor to bottom-right on `sm+` (was centered) and narrow `max-w-3xl → max-w-md` so it no longer overlaps content cards on short pages (e.g. `/contact`). Mobile keeps the centered full-width treatment since there's no competing layout there. Buttons stack vertically inside the card now that horizontal room is tighter, which also reads cleaner alongside the body copy.
- **LandingNav** — replace inline `shadow-[var(--card-shadow-rest)]` with the `.card-impression` class on both the desktop avatar dropdown and the mobile slide-down panel. Inline arbitrary shadow strings on landing surfaces are a DESIGN.md review-blocker; the class indirection lets the component shadow tokens evolve without touching consumers.
- **NotFoundPage** — add Forge eyebrow `[ § 404 — NOT FOUND ]` above the 404 numeral so the page voice stays consistent with the new `/contact` and other bracketed-mono surfaces.
- **LoginPage** — add Forge eyebrow `[ § ENTRY — NYXID ]` above the wordmark for the same voice-consistency reason.
- i18n: new `notFound.eyebrow` and `login.eyebrow` keys in both `en.json` and `zh.json`.

Out of scope and tracked as follow-ups: residual `neon-input` legacy class in 8 form/admin components (#286). Surfaced during the audit but pulling it into this PR would balloon the diff.
