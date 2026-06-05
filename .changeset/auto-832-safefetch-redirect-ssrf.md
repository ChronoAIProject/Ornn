---
"ornn-api": patch
---

Close an SSRF redirect-hop bypass: safeFetch now follows redirects via a bounded manual loop that re-validates each hop's host against the public-address guard and strips cross-host credentials, instead of blindly following 3xx to unvalidated targets.
