---
---

New `ornn-sdk-python/` package — Python client mirroring the TS SDK (search / get / list_versions / download_package / publish / update / delete). `httpx`-based, sync, with `OrnnError` raising on failures and typed dataclasses for responses. Wired into CI via a dedicated `python-sdk-test` job. Closes #110 and completes #31. Python SDK versions independently from the bun packages (own pyproject.toml / PyPI cadence); no ornn-api or ornn-web runtime changes.
