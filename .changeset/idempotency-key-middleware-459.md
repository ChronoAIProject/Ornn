---
"ornn-api": minor
---

Implement the `Idempotency-Key` header documented in CONVENTIONS.md §3.4 (#459).

State-changing requests (`POST` / `PUT` / `PATCH` / `DELETE`) that include an `Idempotency-Key` header now get retry-safe replay semantics: the server fingerprints `(userId, method, path, key)` and caches the response (body + status + headers) in a new `idempotency_keys` Mongo collection for 24h. Retries within that window get the cached response back with `Idempotency-Replay: true` and the handler is NOT re-executed.

Matches the `Idempotency-Key` shape Stripe / Square / AWS / GitHub already expose. Closes a real reliability gap where an agent timing-out on a network blip and retrying could create duplicate skills / redemptions / notifications.

Scope decisions:
- Cache `2xx` + `4xx` responses (a validation error is deterministic for the same input); skip `5xx` (transient, retrying may succeed).
- Keys are scoped per `userId` so two unrelated callers using the same string can't collide.
- 24h TTL via a Mongo TTL index on `createdAt` — sweep cost is negligible at our request volume.
- Keys longer than 255 chars are silently bypassed rather than rejected, to avoid breaking every existing caller as soon as the middleware ships.
