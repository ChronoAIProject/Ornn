---
"ornn-api": patch
---

Close a quota time-of-check/time-of-use race: the per-user/surface quota is now reserved atomically at check time (a conditional increment guarded by the cap) instead of being read first and charged after the LLM call, so concurrent requests can no longer exceed the cap. Failed or aborted calls release the reservation.
