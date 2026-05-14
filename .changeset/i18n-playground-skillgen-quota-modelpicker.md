---
"ornn-web": patch
---

i18n coverage — Playground + Generative skill builder + shared quota / model picker chips (#503). Adds the missing `playground.*` and `generative.*` keys (hero, starters, drawer hint, drawer tabs, pin/unpin, kbHint, env-var hint, validation panel, empty-preview hero/hint) to `en.json` / `zh.json`, and routes `QuotaInline`, `QuotaChip`, and `ModelPicker` through `useTranslation` under new `quota.*` and `modelPicker.*` namespaces. Switching the UI to Chinese now translates these surfaces fully; English copy is unchanged.
