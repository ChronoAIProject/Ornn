---
"ornn-api": patch
---

Playground no longer puts user-supplied env *values* into the LLM prompt and server-side overrides any value the model emits at `execute_in_sandbox` time (#721).

Before this change, `buildSkillContext` injected `KEY=value` pairs into the developer message so the model could pass them through to `execute_in_sandbox`. When a chat-completion provider returned the tool call as plain assistant text instead of a structured tool-call frame (the failure mode #608 fixed for compliant providers — but a non-compliant model can still emit raw JSON in `text-delta`), the env values appeared verbatim in the user-visible transcript. Even with the secret value redacted on the wire, the bug surface was that the secret had ever passed through the LLM at all.

Fix has two layers:

- **Developer message**: list only the env-var *names* the user provided, with a placeholder shape `KEY=<provided-server-side>` and a brief instruction telling the model to reference each by name. The model never has the literal value, so it can't echo it.
- **Tool dispatch**: `runSandboxToolCall` merges `request.envVars` (the real values, supplied by the UI / API caller) *on top of* `args.env` (whatever the model produced). User-supplied keys always win at execution time. Keys the model legitimately invents (sentinel markers, etc.) ride through unchanged.

Net effect: even if a future regression lets the model serialize a tool call as text again, the transcript carries `KEY=<provided-server-side>` instead of the secret, and the sandbox still runs with the real value because the merge happens on the server before `sessionExecute`.

Coverage: 2 new tests in `chatService.test.ts` cover the user-override-wins case (real value replaces model's guessed value, untouched keys ride through) and the no-envVars passthrough case (model-only env reaches sandbox unchanged). All 10 tests in the file green.
