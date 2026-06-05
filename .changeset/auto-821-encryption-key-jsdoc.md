---
"ornn-api": patch
---

Correct the SkillConfig.encryptionKey JSDoc to match the enforced contract (mandatory ≥32 chars, no dev fallback, fail-fast at boot) and add tests pinning loadConfig() ConfigError behavior.
