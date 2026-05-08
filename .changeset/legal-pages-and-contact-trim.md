---
"ornn-web": minor
---

Legal pages for launch — three deep-linkable routes:

- `/legal/privacy` — Privacy Policy (data collected, sub-processors, DSR rights, retention)
- `/legal/terms` — Terms of Service (eligibility, content license, AS-IS, USD 100 / 12-month liability cap, Singapore governing law)
- `/legal/acceptable-use` — Acceptable Use Policy (malicious-code rules, AgentSeal disclosure, content rules, takedown / abuse reporting)

All three share a `LegalLayout` shell with cross-doc nav, last-updated stamp, and footer contact. English-only at launch. Cookie consent banner now links into the Privacy Policy. Landing footer carries Privacy / Terms / Acceptable Use links.

Also drops the placeholder Xiaohongshu card and the brand-decorative "WORKSHOP" stamp from the Contact page — both offered no contact value, the stamp wasn't even a link.

Closes #320.
