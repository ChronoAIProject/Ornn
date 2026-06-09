---
"ornn-api": patch
---

Chat-completion providers now surface structured `execute_in_sandbox` tool calls in the Playground. `parseChatCompletionStream` accumulates streamed `choices[].delta.tool_calls[]` fragments per index and flushes each completed call as a `response.output_item.done` function_call event (the shape the playground consumer reads); the non-streamed `complete()` path maps `message.tool_calls[]` the same way; and the chat-completion request body now sends `tool_choice: "auto"` whenever tools are supplied. Previously tool calls were silently dropped so the sandbox never ran for `apiFormat=chat-completion` providers (#608)
