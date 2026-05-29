---
"ornn-api": patch
---

NyxLlmClient now routes outbound LLM calls on the resolved provider's `apiFormat` (#574).

Background: the admin LLM Provider form exposes `apiFormat: chat-completion | responses`, but the runtime client hard-coded `{gatewayUrl}/responses` for both `stream()` and `complete()` and ignored the setting. Providers behind the Chat Completions API — DeepSeek and any OpenAI-compatible gateway without `/responses` — returned 404 on every skill generation request, surfacing in the UI as a misleading "LLM Gateway error (404)" even though the model/key/gateway were all configured correctly.

Fix: thread `apiFormat` through `resolveLlmProviderForSurface` (`bootstrap.ts`) into the new `LlmProviderResolution.apiFormat` field, and dispatch inside `NyxLlmClient`:

- `responses` → `POST {gatewayUrl}/responses` with the native Responses-API body (unchanged behavior).
- `chat-completion` → `POST {gatewayUrl}/chat/completions` with a translated body (`input` → `messages`, `developer` role → `system`, `max_output_tokens` → `max_tokens`, `instructions` prepended as a `system` message, tools projected into OpenAI function-tool shape). The Chat Completions SSE stream is normalized so each `choices[].delta.content` chunk is yielded as a Responses-API `response.output_text.delta` event — consumers (skill generation + playground) stay format-agnostic.

Tool-call delta normalization for the chat-completion path is intentionally out of scope here; it is tracked in #608 (playground runtime/mixed skills not triggering `execute_in_sandbox` under chat-completion providers).

Trailing slashes on `gatewayUrl` are still trimmed before path concatenation, and the empty-`gatewayUrl` `LLM_PROVIDER_NOT_CONFIGURED` fail-closed branch is preserved.

Coverage: new `src/clients/nyxid/llm.test.ts` covers both formats — endpoint dispatch, body translation (role/field/tool mapping), text-delta normalization, content-part flattening, SA-token fallback, trailing-slash trim, fail-closed, and non-2xx surfacing. 11 tests, all green.
