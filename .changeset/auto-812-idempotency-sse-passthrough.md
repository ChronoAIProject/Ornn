---
"ornn-api": patch
---

Idempotency middleware skips capture for streaming (text/event-stream) responses so SSE streams are delivered unbuffered and never persisted (#812).
