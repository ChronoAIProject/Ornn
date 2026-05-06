---
"ornn-api": patch
"ornn-web": patch
---

fix(playground): real per-event SSE streaming via TransformStream + ChatGPT-style chat polish.

**Streaming fix.** The previous chat route used `new ReadableStream({ start(controller) { ... controller.enqueue(...) } })` with a deferred IIFE producer. Under Bun's HTTP layer, this pattern coalesced 2,000+ enqueues into a single delivery at stream-close — the EventStream tab in DevTools would show every text-delta event arriving at the same millisecond despite the upstream LLM streaming over ~45s. Replaced with `TransformStream + writer.write()`, which establishes proper backpressure with Bun's response consumer: each `await writer.write(chunk)` resolves only once the chunk has been picked up by the HTTP writer, forcing real per-event flushing on the wire. Verified end-to-end via the EventStream tab — events now arrive at distinct timestamps as upstream emits.

**Character-by-character typewriter.** Replaced the synchronous "render every text-delta as it arrives" path with a paced drain in `usePlaygroundChat`. Incoming chars accumulate in a `pendingTokensRef` buffer; a 22ms `setInterval` drains one character per tick onto the displayed message. Adaptive: if the LLM races ahead (>60 chars buffered) the pacer takes 3 chars/tick; past 200 chars it scales to `ceil(buffer/60)` chars/tick so visible text stays within ~1s of received. On `finish`/`tool-call`/`error`/`abort` it drains everything immediately — paced typewriter is a UX nicety, not a contract. Emoji-safe via `Array.from(buffer)` so a 4-byte 😀 counts as one character.

**Chat polish.**
- Composer moved to `max-w-2xl` and lifted off the floor (`pb-6`); model picker + quota chip now sit centered just above the input, ChatGPT-style. Top-right surface header dropped.
- User bubbles use the Forge ember palette: `bg-warning-soft` fill + `border-accent/30` ember outline, contrasted against the assistant's cool `bg-card` bubble.
- Empty-state hero is vertically centered, narrower hero copy + 3 quick-starter chips below.
- Auto-scroll only follows when the user is already at the tail (tracks `distFromBottom < 80`), so scrolling up mid-stream stops the page from chasing.
- Per-skill session lifecycle: chat resets on skillName change AND on unmount.
- Chat header status row only renders once a conversation is active — no "Idle/Ready" noise on the empty state.
- Right-edge drawer (Skill / Env / Package) anchored via `position: fixed` so it stays in view regardless of page scroll.
