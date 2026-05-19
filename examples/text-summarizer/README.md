# text-summarizer

Summarise input text using Claude. ~50 lines of TypeScript; pure stdin/stdout JSON.

**Run:** `ANTHROPIC_API_KEY=sk-ant-... echo '{"text":"..."}' | bun run src/index.ts`

**Adapt:** swap `Anthropic` SDK for another vendor; or wrap the call in retry/streaming. The I/O contract (`{ text, length? }` → `{ summary }`) is intentionally fixed so the skill stays composable.

See `SKILL.md` for the full agent-facing contract.
