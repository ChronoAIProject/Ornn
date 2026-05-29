---
"ornn-web": patch
"ornn-api": patch
---

Chat composer length cap + counter (#654).

The Playground + AI-generation chat composer accepted prompts of any length — the live reproducer was 24 000 chars typed, send button still enabled, no warning. Backend caps existed only for message *count* (100), never message *content*.

Front-end (`ChatInput.tsx`):

- `maxLength={32_000}` on the textarea — browser-side hard cap on typing / paste.
- Live `<used> / <max>` counter appears once the input crosses 24 000 chars (75 %); stays hidden below that so the composer isn't chromed for normal use.
- Counter flips danger-tone + send button disables when content is over the cap (defensive — `maxLength` should make this unreachable, but covers IME / non-browser-paste edge cases).
- Imperative `setValue` (used by suggestion-prompt clicks) truncates past the cap so curated copy can't bypass the limit silently.

Back-end:

- `playgroundMessageSchema.content` adds `.max(MAX_CHAT_MESSAGE_CHARS)` — rejects with `400 content_too_long` (RFC 7807 envelope).
- `skills/generation` JSON path validates prompt length AND each multi-turn message's content length symmetrically — rejects with `400 prompt_too_long` or `400 content_too_long`.

The 32 000-char ceiling is `~8k tokens` at 4 chars/token. Generous for interactive prompts without enabling whole-novel pastes; the three constants are deliberately duplicated across `ChatInput.tsx`, `playground/routes.ts`, and `skills/generation/routes.ts` with cross-referencing comments so a change in one stays in step with the others.

Pinned with `ChatInput.test.tsx` (7 assertions covering `maxLength` attribute, counter visibility, send-enable / disable, imperative truncate, empty disabled).

Closes #654.
