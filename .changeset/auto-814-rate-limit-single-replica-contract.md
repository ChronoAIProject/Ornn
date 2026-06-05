---
"ornn-api": patch
---

Harden the rate limiter's single-replica by-design contract (code + deployment guard) and pin per-pod isolation under test; shared-store backing for multi-replica is tracked in #837 (#814).
