---
---

Add ruff + mypy gates to the Python SDK CI job (#583). `python-sdk-test` previously only ran pytest with respx mocking — lint + type errors could land on develop without detection. Adds ruff config (E/W/F/I/B/UP + per-file exceptions for tests) and a strict-mypy config (boundary `Any` from httpx/respx allowed, internal code stays strict). CI runs `ruff check`, `ruff format --check`, and `mypy` before pytest. Source edits to satisfy the new gates: drop unused `httpx` import in a test fixture, split one over-long line, cast `httpx.Response.content` to `bytes` (typeshed annotates it as `Any`).
