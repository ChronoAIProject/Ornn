---
"ornn-web": patch
---

Pin launch-celebration content to top of `/news` (#553). Mirrors the hardcoded landing-page `LaunchCelebrationPopup` as a permanent News-archive entry so returning visitors who reach `/news` via the navbar — not the landing — still see the public-launch free-credit promo. New `LaunchCelebrationNewsEntry` is a non-modal, `card-impression`-styled article that reuses the popup's `landing.launchPopup.*` i18n keys (EN + ZH inherited verbatim), keeps the click-to-copy NyxID invite chip and "Star on GitHub" CTA, and stamps ahead of the dynamic announcements feed. Independent of `/announcements/active`; remove the JSX + import from `NewsPage.tsx` when the offer ends.
