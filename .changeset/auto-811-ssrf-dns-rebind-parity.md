---
"ornn-api": patch
---

Close DNS-rebind SSRF gap: route chrono-storage, chrono-sandbox, and all NyxID/LLM-gateway outbound requests through a shared fetch-time assertPublicResolvedAddress preflight (#811).
