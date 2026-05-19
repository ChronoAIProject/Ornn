---
---

Add a `python-sdk-audit` CI job + bound the Python SDK dependencies (#445). The previous `httpx>=0.27` constraint (no upper bound) would have silently picked up a hypothetical httpx 1.0 release with breaking semantics; bounds on `httpx`, `pytest`, `respx`, and `pytest-asyncio` keep us inside the 0.x/major lines we've actually tested against. The new CI job runs `pip-audit --strict` against the resolved environment on every PR so a CVE landing on a transitive dep fails CI loudly. Full lockfile (`pip-compile` workflow) deferred — the bounds + audit pair already closes the loud-failure gap without the lockfile maintenance overhead.
