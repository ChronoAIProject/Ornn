---
"ornn-api": patch
---

LLM provider: save preserves model list + Playground default pin is honoured (#588 + #607).

Two related bugs in the LLM-providers admin surface, fixed together because the diagnosis touched the same `providerUpdateSchema` / `listPickerModels` surface:

**#588 — Saving basic provider settings can clear the model list.** `providerUpdateSchema = providerCreateSchema.partial()` inherited the `models: z.array(...).default([])` from the create schema, so a PATCH that omitted `models` came back as `models: []`. The service then ran `if (patch.models)` — truthy on `[]` — and wiped the persisted list. `ProviderEditDrawer`'s basic-settings save sends only `name` / `gatewayUrl` / `apiFormat` / `auth` / `maxOutputTokens` / `defaultTemperature`, no `models` at all, so every basic-fields save nuked the provider's model catalog. Fix: `.extend({ models: z.array(modelInputSchema).optional() })` on the update schema so `undefined` (caller didn't send it) is distinguishable from `[]` (caller explicitly wiped); service uses `patch.models !== undefined` instead of truthy-check. Explicit `[]` still wipes — preserves the model-list-refresh-found-zero-models intent.

**#607 — Playground saved default model not honoured by picker.** `listPickerModels` derived the default slot from the per-model `defaultForX` flag, not from the per-section `playground.defaultModelId` pin. So admins could save Playground settings with a chosen default, the setting persisted correctly, but `/me/models` returned a different model as default — picker pre-selected the wrong row and chat used it. The chat **execute** path's `resolveSurfaceDefaults` (in `bootstrap.ts`) DID honour the pin; only the picker disagreed. Fix: `listPickerModels(surface, sectionDefaultModelId?)` accepts the pin and the picker route resolves it via a new `sectionDefaultResolver` config function that reads `settingsService.getPlayground() / .getSkillGen()`. Pinned model wins the `default` slot AND sorts first in `items`; stale pin (model removed or disabled) falls through to the per-model `defaultForX` flag, matching the resolver's behaviour.

Pinned with 3 new service tests:

- `UT-LLM-004a` — basic-settings save without `models` key preserves existing list (#588 reproducer)
- `UT-LLM-004b` — explicit `models: []` still wipes (#588 symmetry)
- `UT-LLM-004c` — picker honours section pin; stale pin falls through (#607 reproducer)

808 / 0 fail ornn-api tests; typecheck clean.
