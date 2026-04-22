---
"ornn-api": patch
---

Epic 1 final: group NyxID clients + extract SA-token provider (closes #66).

**Clients layout — before → after**
```
clients/authClient.ts            → clients/nyxid/auth.ts
clients/authClient.test.ts       → clients/nyxid/auth.test.ts
clients/nyxLlmClient.ts          → clients/nyxid/llm.ts
clients/nyxidOrgsClient.ts       → clients/nyxid/orgs.ts
clients/nyxidServiceClient.ts    → clients/nyxid/service.ts
clients/nyxidUserServicesClient.ts → clients/nyxid/userServices.ts
(new)                            → clients/nyxid/base.ts
```

`sandboxClient.ts` and `storageClient.ts` stay at the top level — they talk to different external services, not NyxID.

**NyxidSaTokenProvider**

Extracted from the inline closure in `bootstrap.ts` into a first-class class in `clients/nyxid/base.ts`. Same behavior: 24h cache with 60s early-refresh margin, OAuth2 client-credentials grant against `NYXID_TOKEN_URL`. The `getSaAccessToken` callback passed to `StorageClient` / `SandboxClient` is now a one-line wrapper around `saTokenProvider.getAccessToken()`.

Bootstrap shrank by ~30 lines; clients layer is now self-documenting (a `nyxid/` submodule holds everything NyxID-related).

**Closes #66 — Epic 1 complete.** All Epic 1 items shipped across #67 (Topic teardown), #75 (Zod config + requestId + livez/readyz + frontend bug fixes), #76 (CORS hardening), #77 (unified AppError), #78 (validation middleware), #81 (domain merge + activity move), and this PR.

Epic 2 (API v1 cut) is the next unlock.
