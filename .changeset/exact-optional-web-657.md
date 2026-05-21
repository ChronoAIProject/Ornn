---
"ornn-web": patch
---

Enable `exactOptionalPropertyTypes` on ornn-web (#657 part 2).

Closes the ornn-web half of the deferred work from #450. Enabling the flag surfaced 134 errors across ~40 files. Patterns mirror part 1:

1. **Optional component-prop interfaces widen to `T | undefined`** — UI primitives (Input, Select, Badge, MarkdownEditor), form inputs (TagInput, ToolsInput, MultiValueInput, RuntimeSelect), FileTree + SkillFileViewer + SkillPackagePreview, SkillVersionList + SkillVersionsBrowserModal, SkillHeroStrip + AuditVerdictPill + DeprecationBanner, SectionShell, Toast hooks, SkillCard, ExplorePage's TabButton/FilterSidebar/SystemFilters, GenerationChatMessage CompleteBubble, ChatMessage ToolResultMessage. PageTransition uses conditional spread for motion.div's `exit`.

2. **Service-layer + hook params widen** — useSkillAnalytics, useSkillPulls, useSkillAuditHistory, useSystemSkills/useSkills/useMySkills/useSharedWithMeSkills, useAdminQuotaUsers, ChatStreamParams, GenerateStreamParams, SkillSearchParams, SkillSearchResult, SkillVersionEntry, ChatDisplayMessage, GrantInput/BulkGrantInput, StartAuditInput, AdminRedemptionCodeFilters, BufferedCall (analytics).

3. **Settings sections widen via SectionMeta** — `updatedAt`/`updatedBy` accept `T | undefined` so Zod-inferred shapes (Playground, SkillGen, Mirror, NyxId, SkillAudit, Telemetry, Extras) round-trip cleanly.

4. **One type bridge**: `INK_OVERRIDES as unknown as never` for framer-motion's stricter MotionStyle — custom CSS-variable keys aren't expressible in either CSSProperties or MotionStyle under the stricter flag.

No behavior change — every fix is a type-only nudge. 110 web tests + 793 backend + 17 sdk = 920 tests pass; typecheck clean.

Closes #657 (both halves now landed).
