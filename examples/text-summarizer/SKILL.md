---
name: text-summarizer
description: Summarise a chunk of text down to roughly `length` words using the agent's configured LLM provider. Input shape `{ text: string, length?: number }` on stdin, JSON; output shape `{ summary: string }` on stdout, JSON. Minimal: ~50 lines, no streaming, no retries — a deliberate baseline so the wiring is visible. For a production summariser, fork this and add retries, prompt-injection sanitisation, length validation, and per-model cost tracking.
version: "1.0"
license: MIT
metadata:
  category: text
  tag:
    - example
    - llm
    - summarization
    - typescript
---

# text-summarizer

A minimum-viable LLM skill — the smallest amount of code that takes structured input, calls an LLM, and emits structured output.

## Contract

**Input** (stdin, JSON):

```json
{ "text": "...long input...", "length": 60 }
```

- `text` (string, required) — what to summarise.
- `length` (number, optional, default 60) — target word count for the summary.

**Output** (stdout, JSON):

```json
{ "summary": "..." }
```

**Errors** — written to stderr as `{ "error": "...message..." }` and exit code `1`.

## Required environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Talks to Claude. Swap the SDK call to point at OpenAI / Gemini / your own backend; nothing else changes. |

## Run locally

```bash
cd examples/text-summarizer
bun install
ANTHROPIC_API_KEY=sk-ant-... echo '{"text":"...","length":40}' | bun run src/index.ts
```

## Adapt this

- **Different model vendor** — replace `Anthropic` with the SDK of your choice; the I/O shape stays.
- **Stream output** — emit one JSON line per token instead of one final blob.
- **Sanitise input** — the current code passes `text` to the model verbatim; for untrusted callers, strip control characters and cap length before the API call.
