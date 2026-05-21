---
"ornn-api": patch
---

Enable `exactOptionalPropertyTypes` on ornn-api (#657 part 1).

Closes the ornn-api half of the deferred work from #450. Enabling the flag surfaced 77 errors across ~35 files. Patterns:

1. **Optional class fields** assigned from optional deps widen to `T | undefined`. Clients (NyxidOrgsClient, SandboxClient, StorageClient), services (QuotaService.notificationService, AuditService.notificationService/nyxidOrgsClient, SkillService.analyticsEmitter/agentsealScanner).

2. **Optional interface fields** widen to `T | undefined` so call sites passing Zod-inferred shapes (`{ field: T | undefined }`) fit: SettingsActor, RedemptionCodeDoc, AuditRecord, CreateSkillData, CreateSkillVersionData, GitHubPullInput, SkillDocument, SkillDetailResponse, SkillSearchItem, SkillSource, ExportImportRoutesConfig, SettingsAuditLogger, GeneratedSkill, FetchedBundle, FetchOptions, ExtraFilters, search service params, UpdateAnnouncementInput, UpdateBroadcastDocInput, UpdateBroadcastParams, PlaygroundChatRequest.

3. **Conditional spread at call sites** for routes/services passing Zod-validated bodies: admin-users, admin/quota, admin/redemption-codes, analytics, notifications, playground, quota, skills setNyxidService, generation resolveModel, analytics emitter + posthog capture, apiRequestTracking, nyxidAuth.

4. One Zod refinement param widened to `Record<string, unknown>` (announcements `assertCtaPairing`) so it works against both create + update schemas under the stricter inferred types.

5. One cast in skill generation — Zod's `.optional()` produces `outputType: "text" | "file" | undefined` (explicit-undefined-non-optional) vs the interface's `outputType?:` (optional-with-undefined). Same shape; cast bridges the contract.

No behavior change — every fix is a type-only nudge. 793 backend tests still pass; typecheck clean.

ornn-web's `exactOptionalPropertyTypes` (~134 errors) is the remaining half of #657 and ships in a follow-up commit.
