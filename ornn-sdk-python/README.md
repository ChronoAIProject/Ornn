# ornn-sdk (Python)

Python client for the [Ornn](https://github.com/ChronoAIProject/Ornn) skill platform.

Wraps the `/api/v1/*` HTTP surface with auth injection, response-envelope unwrapping, and typed errors (`OrnnError`). Mirrors the [TypeScript SDK](../ornn-sdk) so agents written in either language have the same programmatic entry point.

> Authentication uses NyxID access tokens. Pair this SDK with your existing NyxID auth flow — this package does not handle OAuth.

## Install

```bash
pip install ornn-sdk
# or with uv / poetry / pdm — whichever you prefer
```

Requires Python 3.10+.

## Quickstart

```python
import os
from ornn_sdk import OrnnClient

with OrnnClient(
    base_url="https://ornn.chrono-ai.fun",
    token=os.environ["NYXID_ACCESS_TOKEN"],
) as ornn:
    # Search
    result = ornn.search(q="pdf", scope="public")

    # Read
    skill = ornn.get(result.items[0].id)

    # Pull
    pkg = ornn.download_package(skill.id, skill.latest_version)
    # pkg is raw bytes — write to disk, pass to zipfile, etc.

    # Publish
    new_skill = ornn.publish(pkg)
```

## Token refresh

For long-running processes, pass a `token_resolver` callable instead of a static token:

```python
ornn = OrnnClient(
    base_url="https://ornn.chrono-ai.fun",
    token_resolver=lambda: nyxid_session.access_token(),
)
```

The resolver is invoked on every request, so your existing caching / refresh logic is reused.

## Errors

Any non-2xx response (or a 2xx with a failure envelope) raises `OrnnError`:

```python
from ornn_sdk import OrnnClient, OrnnError

try:
    ornn.get("unknown")
except OrnnError as err:
    print(err.status, err.code, err.request_id)
    # 404 resource_not_found req_01HXYZ...
    raise
```

Error codes follow [`docs/conventions.md` §1.4](../docs/conventions.md) (lowercase snake_case).

## API

| Method | What |
|---|---|
| `search(...)` | `GET /skill-search` — returns `SkillSearchResult` |
| `get(guid_or_name, version=None)` | `GET /skills/:id` — returns `SkillDetail` |
| `list_versions(guid_or_name)` | `GET /skills/:id/versions` — returns `list[SkillVersionEntry]` |
| `download_package(guid, version)` | `GET /skills/:id/versions/:v/download` — returns `bytes` |
| `publish(zip_bytes, skip_validation=False)` | `POST /skills` — returns `SkillDetail` |
| `update(id, metadata=..., zip_bytes=..., skip_validation=False)` | `PUT /skills/:id` — returns `SkillDetail` |
| `delete(id)` | `DELETE /skills/:id` |
| `request(method, path, **kwargs)` | escape hatch for any other `/api/v1/...` call |

For the complete contract see [`docs/conventions.md`](../docs/conventions.md) and `/api/v1/openapi.json`.

## Status

First-cut Python SDK, covers read + write + download paths. Streaming endpoints (skill generation, playground chat) are not yet wrapped — callers can use `client.request()` as an escape hatch, or wait for a dedicated streaming API.

Async flavor (`AsyncOrnnClient` backed by `httpx.AsyncClient`) is a small follow-up; the sync client is intentionally the default for notebook / script use.

## Development

```bash
# From ornn-sdk-python/
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```
