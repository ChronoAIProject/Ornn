# API Reference — Playground (SSE)

## `POST /api/v1/playground/chat`

**Multi-turn chat with optional skill injection and sandbox tool execution.**

> **Auth required.** Permission: `ornn:playground:use`.

### Request body (`application/json`)

```jsonc
{
  "messages": [
    {
      "role": "user" | "assistant" | "tool" | "system",
      "content": "...",
      "toolCalls": [ { "id": "...", "name": "execute_script", "args": { ... } } ],
      "toolCallId": "..."
    }
  ],
  "skillId": "<guid or name>",       // optional
  "envVars": { "API_KEY": "..." }    // optional, injected into sandbox runs
}
```

`messages` is 1–100 entries; each requires `role` + `content`. Server-side tool-use loop runs up to 5 rounds.

### Response

SSE stream — text deltas + tool-call events. Event names use kebab-case:

| Event | Payload | Meaning |
|---|---|---|
| `text-delta` | `{ "delta": "<text>" }` | Incremental assistant text |
| `tool-call` | `{ "id": "...", "name": "execute_script", "args": { ... } }` | Server is invoking a tool |
| `tool-result` | `{ "id": "...", "result": { ... } }` | Tool returned |
| `file-output` | `{ "path": "...", "content": "<text or base64>", "encoding": "utf8" \| "base64" }` | Tool produced a file artifact |
| `finish` | `{ "reason": "stop" \| "max_rounds" \| "error", "message"?: "<text>" }` | Stream closes after this |

Side effect: when bound to a real skill, fires a `pull` analytics event with `source = "playground"`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Message-array schema failed |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:playground:use` |
