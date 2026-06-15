---
"ornn-api": patch
---

NyxLlmClient now normalizes Chat Completions tool-call deltas into the same Responses-API `response.output_item.done` / `function_call` events the playground tool loop already consumes (#608).

Background: #574 routed chat-completion providers to `/chat/completions` and translated text deltas, but the stream parser ignored `choices[].delta.tool_calls`. The playground tool-use loop in `chatService.ts` only matches on Responses-API `response.output_item.done` with `item.type === "function_call"`, so when a chat-completion provider (DeepSeek, Together, any OpenAI-compat gateway) responded with a tool call, no `function_call` event ever reached the loop. The model's `execute_in_sandbox(...)` invocation arrived as plain assistant text and got rendered as JSON in the chat instead of being executed — runtime-based and mixed skills appeared to "respond" without ever running the sandbox.

Fix: `parseChatCompletionStream` keeps a per-index `Map<number, ToolCallAccumulator>` carrying `{id, name, arguments}`. Each `choices[].delta.tool_calls[]` chunk merges into its index buffer (id + name arrive on the first chunk for that call; the `arguments` JSON string accumulates across many chunks). A turn flushes when any of: explicit `finish_reason` (`tool_calls`, `stop`, anything non-null), upstream `[DONE]` sentinel, or stream EOF — whichever fires first. A `flushed` guard makes flush idempotent so we never double-emit if multiple end signals fire.

The synthesized event matches the Responses-API shape `chatService.ts` already validates with Zod (`outputItemDoneEventSchema`):

```js
{
  type: "response.output_item.done",
  item: {
    type: "function_call",
    id, call_id, name, arguments,  // arguments is the accumulated JSON string
  },
}
```

This way zero changes are needed in `chatService.ts` — its existing `pendingToolCall` capture + `executeToolCall` dispatch path works for both upstream formats now.

Parallel tool calls within one assistant turn are supported (one done event per index, emitted in index order). Missing `index` falls back to 0 (treated as a single tool call). Streams that close without `[DONE]` or `finish_reason` still flush at EOF so a buffered call is never lost.

Coverage: 6 new tests appended to `src/clients/nyxid/llm.test.ts` — chunked accumulation + finish_reason flush, EOF flush without [DONE], parallel tool calls, idempotent flush across finish_reason+[DONE], intermixed text+tool deltas (correct event order), missing `index` fallback. All 17 tests in the file green; full ornn-api suite has no new regressions.
