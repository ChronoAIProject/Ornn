---
"ornn-api": patch
---

chore(deploy): audit + clean env-var surface (#287).

Three categories of cleanup against `deployment/ornn-api/{deployment.yaml, mirror-cronjob.yaml}` and `deployment/.env.sample.ornn`:

1. **Removed 11 stale env vars** that no code consumes anymore — each was migrated into `platform_settings` admin sections in earlier rounds (#268, #269, #270, #271): `NYX_LLM_GATEWAY_URL`, `STORAGE_SERVICE_URL`, `STORAGE_BUCKET`, `SANDBOX_SERVICE_URL`, `DEFAULT_LLM_MODEL`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE`, `SSE_KEEP_ALIVE_INTERVAL_MS`, `EXTRA_NYXID_SERVICES`, `AGENTSEAL_ENABLED`, `AGENTSEAL_TIMEOUT_MS`.
2. **Added 3 missing env vars** that code reads but the manifests were not plumbing through: `AGENTSEAL_PYTHON`, `AGENTSEAL_SCRIPT`, `ORNN_URL_ALLOWLIST_CIDR`.
3. **Renamed 3 vars** to drop a useless alias layer — `.env.ornn` keys now match the actual container env-var names: `ORNN_API_PORT → PORT`, `ORNN_API_LOG_LEVEL → LOG_LEVEL`, `ORNN_API_LOG_PRETTY → LOG_PRETTY`.

**Operator action required.** After pulling this release, update local `deployment/.env.ornn`:
- Rename `ORNN_API_PORT` → `PORT`, `ORNN_API_LOG_LEVEL` → `LOG_LEVEL`, `ORNN_API_LOG_PRETTY` → `LOG_PRETTY`.
- Add `AGENTSEAL_PYTHON` (default `/opt/agentseal/bin/python`), `AGENTSEAL_SCRIPT` (default `/opt/agentseal/scan_skill.py`), and `ORNN_URL_ALLOWLIST_CIDR` (operator-explicit comma-separated allowlist of trusted hostnames + IPv4 CIDRs).
- Remove the 11 stale vars listed above — they have no effect anymore.

ornn-web's configmap + entrypoint were already clean — no change to web manifests.
