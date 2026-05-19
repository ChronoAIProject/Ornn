---
"ornn-api": patch
---

Validate the LLM re-ranker response with Zod instead of an `as Array<...>` cast (#444). `JSON.parse(...) as Array<...>` is a runtime no-op; a malformed model response previously slipped through the GUID filter and broke downstream score arithmetic with `NaN`/`undefined`. The new `rerankResponseSchema` enforces `id` is a non-empty string and `score` is a finite number before the row reaches the filter; schema failures log a warning with the first three Zod issues and return the empty batch (same fail-safe as before, just observable now).
