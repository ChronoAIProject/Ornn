# Performance FAQs

## How fast is skill search?

Keyword search is near-instant. Semantic search (vector similarity) typically responds within 200-500ms depending on the size of the skill library.

## What are the execution time limits?

Default sandbox execution timeout is 30 seconds. This can be adjusted per-skill in the SKILL.md frontmatter.

## How large can a skill package be?

The maximum ZIP upload size is **50 MB**. Individual files within the package should be kept as small as practical.

## Does execution scale with concurrent users?

Yes. The chrono-sandbox service supports horizontal scaling. Each skill execution runs in an isolated container.

## What about LLM latency in the Playground?

Playground responses stream in real-time via SSE. First-token latency depends on the LLM provider (via NyxID Gateway) and typically ranges from 500ms to 2s.

## Are there rate limits?

API rate limits are managed by NyxID. Check your NyxID dashboard for current limits based on your plan.
