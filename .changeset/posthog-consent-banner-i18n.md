---
"ornn-web": patch
---

frontend: i18n the PostHog cookie-consent banner.

The GDPR analytics-consent banner (`CookieConsentBanner`) was hardcoded in English. Pulled every visible string — the `[ § ANALYTICS — CONSENT ]` stamp, the title, the body (with inline PostHog + Privacy Policy links), and the Accept / Decline buttons — out into a new `cookieConsent.*` block in `i18n/en.json` and `i18n/zh.json`. The body uses `<Trans>` with named `postHogLink` / `privacyLink` component slots so the link anchors stay translation-friendly without splitting the sentence into glued fragments. zh visitors now see the banner in Chinese; switching language via the existing `ornn-lang` toggle re-renders it live.
