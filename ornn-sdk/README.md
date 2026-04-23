# @chronoai/ornn-sdk

TypeScript client for the [Ornn](https://github.com/ChronoAIProject/Ornn) skill platform.

Wraps the `/api/v1/*` HTTP surface with auth injection, response-envelope unwrapping, and typed errors (`OrnnError`).

> Authentication uses NyxID access tokens. Pair this SDK with your existing NyxID auth flow — this package does not handle OAuth.

## Install

This package lives inside the Ornn monorepo. Once published to npm:

```bash
bun add @chronoai/ornn-sdk
# or
npm install @chronoai/ornn-sdk
```

## Quickstart

```ts
import { OrnnClient } from "@chronoai/ornn-sdk";

const ornn = new OrnnClient({
  baseUrl: "https://ornn.chrono-ai.fun",
  token: process.env.NYXID_ACCESS_TOKEN!,
});

// Search
const { items } = await ornn.search({ q: "pdf", scope: "public" });

// Read
const skill = await ornn.get(items[0]!.id);

// Pull
const pkg = await ornn.downloadPackage(skill.id, skill.latestVersion!);
// pkg is an ArrayBuffer — write to disk, unzip, etc.

// Publish
const newSkill = await ornn.publish(pkg); // or a Blob / Uint8Array
```

## Token refresh

For long-running processes, pass an async resolver instead of a static token:

```ts
const ornn = new OrnnClient({
  baseUrl: "https://ornn.chrono-ai.fun",
  getToken: async () => nyxidSession.getAccessToken(), // refreshes if needed
});
```

`getToken` is invoked on every request, so whatever caching / refresh logic your auth layer implements is reused.

## Errors

Any non-2xx response (or a 2xx with a failure envelope) throws `OrnnError`:

```ts
import { OrnnError } from "@chronoai/ornn-sdk";

try {
  await ornn.get("unknown");
} catch (err) {
  if (err instanceof OrnnError) {
    console.error(err.status, err.code, err.requestId);
    // e.g. 404 resource_not_found req_01HXYZ...
  }
  throw err;
}
```

Error codes follow [`docs/conventions.md` §1.4](../docs/conventions.md) (lowercase snake_case).

## API

| Method | What |
|---|---|
| `search(params)` | `GET /skill-search` |
| `get(guidOrName, version?)` | `GET /skills/:id` |
| `listVersions(guidOrName)` | `GET /skills/:id/versions` |
| `downloadPackage(guid, version)` | `GET /skills/:id/versions/:version/download` (returns `ArrayBuffer`) |
| `publish(zip, options?)` | `POST /skills` (`application/zip` body) |
| `update(id, { metadata? | zip? }, options?)` | `PUT /skills/:id` |
| `delete(id)` | `DELETE /skills/:id` |
| `request(method, path, init)` | escape hatch for any other `/api/v1/...` call |

For the complete contract see `docs/conventions.md` and `/api/v1/openapi.json`.

## Status

First-cut TS SDK, read + write + download paths covered. Streaming endpoints (skill generation, playground chat) are not yet wrapped — callers can use `client.request` as an escape hatch, or wait for a dedicated streaming API on this client.

Python SDK is tracked in a separate issue.
