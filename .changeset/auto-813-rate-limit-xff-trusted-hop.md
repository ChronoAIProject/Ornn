---
"ornn-api": patch
---

Rate-limit keys anonymous traffic on a trusted-position X-Forwarded-For hop (configurable via ORNN_TRUSTED_PROXY_HOPS), not the spoofable leftmost token (#813, CWE-348).
