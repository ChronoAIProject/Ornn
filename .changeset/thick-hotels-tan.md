---
"ornn-api": patch
"ornn-web": patch
---

fix: relax Extras section's service-name regex to allow mixed case + dot/underscore (#284).

Was lowercase-only (`^[a-z0-9-]{1,64}$`), which rejected the legacy `EXTRA_NYXID_SERVICES` env var's own default value (`NyxID`) and any common service identifier with mixed case. Now matches the typical service-id shape: `^[A-Za-z0-9._-]{1,64}$` — covers `NyxID`, `twitter-api`, `openai_v2`, `v1.beta`. Spaces still rejected (the value flows into URL path segments where space encoding is fragile).
