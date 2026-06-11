---
"ornn-api": minor
"ornn-web": minor
---

Skillset browse + detail upgrades (#1080): the browse page gains a keyword search box (new `q` param on `GET /skillset-search` — case-insensitive substring on name + description) and drops the per-card edit button (manage from the detail page). The skillset detail page's left pane becomes a member skill-package viewer — click any member skill in the set to view its files read-only, mirroring the skill detail page — and the master prompt moves into the top metadata card. The dependency graph and resolved closure are preserved as read-only rail cards.
