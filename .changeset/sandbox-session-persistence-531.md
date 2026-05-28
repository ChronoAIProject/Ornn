---
"ornn-api": patch
---

PlaygroundChatService now reuses a per-language chrono-sandbox session across tool-use rounds within one chat (#531).

Background: every `execute_in_sandbox` tool call went to chrono-sandbox's one-shot `/execute` endpoint, which provisions a fresh kernel each invocation. As a result, anything a previous round installed (CLIs like `nyxid`, npm packages, generated files, env writes) was lost the next round. The LLM would `nyxid login`, then the next call would see no login. Users assumed the flow was working because each individual call succeeded — but the chat-level state never accumulated.

Fix: in `chat()`, declare a per-stream `Map<language, sessionId>` plus a `createdSessionIds` list. The first `execute_in_sandbox` call for a given language lazily calls `sandboxClient.createSession({ language, dependencies, env, inputFiles, ttlSecs: 600, networkEnabled: true })` and records the session id; subsequent same-language calls hit `sessionExecute(sessionId, ...)` against the persistent kernel. A different language inside the same chat (e.g. javascript then python) lazily creates a second session.

The whole tool loop is wrapped in `try / finally`; on exit (normal, error, abort) we best-effort `deleteSession` every session we created. chrono-sandbox also expires via `ttlSecs`, so a delete failure logs at `warn` and otherwise falls through — leftover sessions TTL out.

Fail-open fallbacks preserve pre-fix behaviour if the session layer is unavailable:

- `createSession` throws → log warn, fall back to one-shot `execute()` for that round; no session recorded.
- `sessionExecute` throws → log warn, drop the stale session id from the map (next same-language call will recreate), fall back to one-shot `execute()` for that round.

Plain (non-sandbox) chats touch nothing — no createSession, no deleteSession, zero overhead.

Coverage: new colocated `src/domains/playground/chatService.test.ts` exercises the path with a stub `NyxLlmClient` (queued per-round event sequences) and a recording sandbox stub — asserts session creation count, sessionExecute reuse, multi-language isolation, finally-cleanup, both fail-open branches, plain-chat no-op, and delete-failure suppression. 8 tests, all green.
