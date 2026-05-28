---
"ornn-api": patch
---

`runSandboxOneShot` now translates chrono-sandbox HTTP errors into a one-line user-facing message and logs structured diagnostics, so the playground transcript stops surfacing raw JSON like `Sandbox service error (500): {"error":"internal_error","error_code":1006,"message":"An internal error occurred"}` (#530).

Background: `SandboxClient.post` throws an `Error` whose message is `"Sandbox service error (<status>): <raw body>"`. The playground catch handler spat that string straight into the chat. The QA's repro on the `nyxid` skill (`https://ornn.chrono-ai.fun/playground?skill=nyxid` → `LIST CAPABILITIES`) hit a chrono-sandbox internal 500 with `error_code: 1006` and the transcript showed the raw JSON envelope verbatim — useless to the user, and presented as if the failure were the user's fault.

Fix: new `formatSandboxError` helper parses the `"Sandbox service error (<status>): <body>"` shape. If the body is the structured `{ error, error_code, message }` envelope, it returns a friendly sentence keyed off `status` (500 / 1006 → transient sandbox-server hint, 503/504 → timeout hint, anything else → `HTTP <status> [code N]: <message>`). When the body isn't JSON or the regex doesn't match, it falls back to the raw message so any new upstream shape still reaches the operator. Pino `error` log carries `language`, `scriptLen`, and the raw error message so admins can grep production for 1006-class failures without scrolling chat transcripts.

The underlying chrono-sandbox 500s themselves are out of scope — those originate inside the sandbox runtime, not Ornn. This change is about UX of the failure surface.

`runSandboxToolCall`'s `sessionExecute` catch path stays as-is (it already falls back to the one-shot path, which now formats the error before returning).
