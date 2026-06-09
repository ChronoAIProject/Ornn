---
"ornn-api": patch
---

Playground chat: a client abort (or error) after billable output now commits the reserved quota slot instead of refunding it, closing the abort-after-first-token free-usage path (#766)
