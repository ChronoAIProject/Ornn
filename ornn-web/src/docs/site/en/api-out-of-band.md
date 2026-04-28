# API Reference — Out-of-band Endpoints

These four routes live outside `/api/v1` and are intended for infrastructure (k8s probes, OpenAPI tooling).

## `GET /health`

**Liveness probe (alias of `/livez`).**

> **Auth: anonymous.**

Used by k8s liveness checks and uptime monitors.

**Response 200**

```json
{
  "status": "ok",
  "service": "ornn-api",
  "version": "0.4.0",
  "timestamp": "2026-04-28T07:00:00.000Z"
}
```

No errors.

---

## `GET /livez`

**k8s liveness probe.**

> **Auth: anonymous.**

Identical body to `/health`.

---

## `GET /readyz`

**k8s readiness probe.**

> **Auth: anonymous.**

Pings MongoDB with a 2-second timeout.

**Response 200 (ready)**

```json
{
  "status": "ready",
  "service": "ornn-api",
  "mongoLatencyMs": 8
}
```

**Response 503 (not ready)**

```json
{
  "status": "not_ready",
  "reason": "mongo_unreachable"
}
```

---

## `GET /api/v1/openapi.json`

**Auto-generated OpenAPI 3 spec.**

> **Auth: anonymous.**

Generated from the Zod schemas attached to each route (Hono `@hono/zod-openapi` integration). Useful for SDK generators and IDE tooling. The document is regenerated per process start.
