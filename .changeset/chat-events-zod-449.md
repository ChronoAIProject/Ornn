---
"ornn-api": patch
---

Type-check playground LLM stream events with a Zod discriminated union (#449). `chatService` previously read `event.type`, `event.delta`, `event.item` via `as any` — a runtime no-op that let upstream field renames silently propagate `undefined` through the SSE stream to clients. Three permissive schemas (`response.output_text.delta`, `response.content_part.delta`, `response.output_item.done`) now gate every event; unknown shapes are dropped with a debug log so the upstream API can add fields freely without breaking us.
