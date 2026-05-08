---
"ornn-web": patch
---

PostHog browser hardening:

- **`respect_dnt: true`** — opt out of capture when the browser sends Do-Not-Track. GDPR/CCPA affinity, complements the cookie banner.
- **`maskTextSelector: "*"`** in session-recording config (replaces the narrower `[data-ph-mask], input[type='password']` selector). Every rendered text node is now masked in replays — skill content, user names, emails, activity feeds. Trade-off: replays lose visual fidelity but no longer carry PII. Opt specific elements back in with `data-ph-no-mask` when an element is genuinely public chrome.

Closes #304.
