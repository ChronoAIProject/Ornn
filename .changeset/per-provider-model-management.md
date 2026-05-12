---
"ornn-api": minor
"ornn-web": minor
---

feat: fold model catalog into LLM provider settings — single-source per-provider model management (#270).

Replaces the parallel `/admin/models` global catalog with a single, per-provider, drawer-based flow. Click a provider in **Admin → Settings → LLM Providers** and a new **Models** action opens a side drawer listing every model the provider has synced. Per row: enable for Playground, enable for SkillGen, default for Playground (radio), default for SkillGen (radio). Defaults are global across providers — the server enforces at-most-one-true per surface in the same write that flips a flag, so picking a new default unselects every other model's default for that surface automatically.

Backend
- `LlmProviderModel` schema extended: `enabledForPlayground`, `enabledForSkillGen`, `defaultForPlayground`, `defaultForSkillGen`. Old `enabled: boolean` is gone — newly synced models arrive with all four flags `false` so adding a row to the upstream catalog never auto-changes platform behaviour.
- `LlmProvider.defaultModelId` removed — defaults live on the per-model rows now, scoped per-surface.
- New `PATCH /api/v1/admin/settings/llm-providers/:providerId/models/:modelId` for partial flag updates. Server enforces:
  - at-most-one default per surface across all providers (single write — `clearDefaultsForSurfaceExcept` runs first),
  - `defaultForX: true` ⇒ `enabledForX: true` (forced in the same write),
  - rejects when the row is `removed: true`.
- `GET /api/v1/me/models?surface=...` rewired to union across every provider's `models[]`. Picker still returns flat `{ modelId, displayName, isDefault }` rows so SDK callers don't need to handle the provider dimension.
- Idempotent boot migration (`migrateModelCatalogIntoProviders`) reads the legacy `models` collection, copies each row's surface flags onto the matching `(providerId, modelId)` slot in `llm_providers.models[]`, then drops the legacy collection. Repository ships a `normalizeModel` shim so reads survive even before the migration runs (e.g. cron pods that boot mid-migration).
- `domains/models/` module deleted: routes, service, repository, types. The catalog client (`NyxLlmCatalogClient`) is no longer wired — per-provider sync uses each provider's own `modelListUrl`.
- `playground` and `skill-gen` execute paths swapped to `LlmProvidersService.resolveModel({ surface, requested })`. Same `ModelResolution` shape, same HTTP error codes, same `throwModelResolutionError` helper (now exported from `domains/settings/llmProviders/routes.ts`).
- 547/547 backend tests pass; new tests cover the at-most-one-default invariant + the `defaultForX → enabledForX` coherence rule.

Frontend
- New `ProviderModelsDrawer` (640px slide-in): per-row toggles for the two surface-enable flags, radios for the two surface-defaults, archived rows segregated below. Each interaction fires a per-model PATCH; on success the provider list invalidates so a sibling provider's default flip cascades into the open drawer's view on the next refetch.
- `LlmProvidersSection` table now shows per-surface counts (`X playground · Y skillGen · Z total`) and a new **Models** action. The "Default" column is gone (defaults are per-model now).
- `ProviderEditDrawer` lost its "Default model" select — that drawer is connection-config only (auth, gateway URLs, max tokens, temperature).
- `/admin/models` page removed from the SPA. `services/modelsApi.ts` trimmed to picker-only; `useModels` keeps `usePickerModels` + `usePreferredModel` and drops the admin hooks. `LlmProviderConfigCard` deleted (only consumer was the deleted page). `App.tsx` route + lazy-import dropped. `pages/admin/index.ts` re-export dropped.
- Section-level default-model dropdowns (Playground / SkillGen / SkillAudit) now filter the provider's models by the relevant `enabledFor<Surface>` flag instead of the dropped `enabled` boolean.

Migration / data shape

The old global `models` collection is dropped automatically on first boot under the new code. Everything that was an enabled/default flag in that collection is now a per-(provider, modelId) flag inside the per-provider arrays. After deploy, admins should re-verify their per-surface defaults via **Admin → Settings → LLM Providers → Models** and not via a separate page.
