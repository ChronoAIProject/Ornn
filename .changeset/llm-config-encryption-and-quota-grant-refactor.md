---
"ornn-api": minor
"ornn-web": minor
---

feat: admin LLM provider config (encrypted at rest, mid-masked in UI), additive quota grants with period, AgentSeal Python wrapper, admin user collection, runtime LLM override.

**LLM provider override (admin panel)** — `/admin/models` gets a `LlmProviderConfigCard` letting an admin paste a custom gateway URL + bearer key without redeploying. The key is encrypted with AES-256-GCM (`infra/crypto`, scrypt-derived from `ENCRYPTION_KEY`) before hitting Mongo and decrypted at the service boundary on each read; the UI mid-masks the persisted key (first 4 + last 4, bullets in the middle) so the operator can sanity-check which key is in place without exposing the body. Round-tripping the masked value preserves the existing key — the bullet character is the sentinel and is rejected if a fresh key would somehow contain one. Override takes effect on the next LLM call (no pod restart) via a `runtimeOverrideEnabled` resolver on `NyxLlmClient`.

**Quota grants are additive with a period** — admin grants now stack on top of any existing balance instead of overwriting (`grant()` accepts `periodMonths`, persists to a `quota_grants` ledger with `consumed`/`expiresAt`). The admin quota table shows used/limit · daily · +bonus per user; the playground chip shows the effective remaining balance.

**AgentSeal trust scanner** — replaced the broken `agentseal guard` CLI with a Python wrapper (`scripts/scan_skill.py`) that drives `agentseal.skill_scanner.SkillScanner` directly, plus a manual rescan button on the trust badge so an operator can re-run a stuck scan without re-publishing.

**Admin user collection** — replaces `ORNN_ADMIN_EMAILS` env. Authenticated users with `ornn:admin:skill` are lazily inserted into `admin_users` by the auth middleware; routes that need an admin filter consult that collection.

**New env var** — `ENCRYPTION_KEY` (32+ chars, generate with `openssl rand -hex 32`). When unset, the API falls back to a clearly-marked dev sentinel; production deployments **must** set this — rotating it makes every previously-encrypted secret unreadable.
