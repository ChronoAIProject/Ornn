# Ornn API Deprecations

The public log of every deprecated route, response field, or header on `/api/v1/*`. The companion to [`docs/API_STABILITY.md`](API_STABILITY.md) (policy) and [`docs/CONVENTIONS.md`](CONVENTIONS.md) §7 (header shape).

Per `docs/API_STABILITY.md` § Deprecation policy, every entry below carries:

- **Anchor** — used in the `Link: <…>; rel="deprecation"` header so clients can deep-link from the response.
- **Deprecated in** — the release that first set `Deprecation: true`.
- **Sunset on** — the date the route MAY be removed (at the earliest).
- **Replacement** — the route or field clients should migrate to.
- **Migration notes** — what changes for the caller.

When a deprecated route is removed, its entry stays in this file but moves to the [Removed](#removed) section so the anchor URL keeps resolving.

---

## Active deprecations

*None.* While Ornn is in alpha (`0.x`), breaking changes go straight into the next minor release without a deprecation cycle — see [`docs/API_STABILITY.md`](API_STABILITY.md) § Current state. This section starts populating once the API exits alpha and the post-v1 policy kicks in.

---

## Removed

*None.*

---

## How an entry will look

When the first deprecation lands, it will look like this:

```markdown
### skill-version-v1

- **Anchor:** `skill-version-v1`
- **Deprecated in:** `1.4.0` (2026-09-15)
- **Sunset on:** `1.6.0` or 2026-12-15, whichever is later
- **Replacement:** `GET /api/v1/skills/:id/versions/:version` → use `GET /api/v1/skills/:id/versions/:version?manifest=v2`
- **Migration notes:** the response gains a `runtime: { type, entrypoint }` block and drops the flat `runtimeType` / `entrypoint` fields. Clients reading the v1 shape continue to work until sunset; the SDK auto-upgrades when `Accept-Stability: stable` is set.
```

Response headers from a deprecated route would carry:

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Tue, 15 Dec 2026 00:00:00 GMT
Link: <https://github.com/ChronoAIProject/Ornn/blob/main/docs/DEPRECATIONS.md#skill-version-v1>; rel="deprecation"
```
