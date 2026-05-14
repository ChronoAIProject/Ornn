---
"ornn-api": patch
---

Swap the privacy-mask glyph in redemption-code grant notes from `…` (U+2026) to `****`. The ellipsis is unambiguous in the audit log but reads as "text truncated, click to see more" in the new `/notifications` detail modal (#532), so users kept asking why the full code was hidden. The mask now signals *masked* rather than *truncated*. Only the first four chars of the code still leak — privacy intent unchanged. Closes #549.

Affects new audit + notification rows generated after this lands; historical rows continue to carry `…` (no migration — old rows are clearly QUOTA-tagged and redemption-sourced, no semantic loss).
