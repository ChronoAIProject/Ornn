---
"ornn-web": patch
---

Harden the "Generate skill" modal (security). The user's access token is no longer attached as a bearer header when fetching an OpenAPI spec from a non-NyxID host (it was previously sent to whatever host the service's spec URL pointed at), and the redundant `userToken`/`proxyUrl` fields are dropped from the generate request body. The markdown-reference upload now enforces a 10 MiB per-file size limit before reading the file into memory. (#1037)
