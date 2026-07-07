---
---

docs(skill): fix `ornn-agent-manual-cli` v1.4 frontmatter — the `description` contained an unquoted `: ` (colon-space) that broke YAML parsing on ingest/refresh, and exceeded the 1024-char cap. Reworded to remove the colon and trimmed to 993 chars; verified against the API's `yaml.parse` + `validateSkillFrontmatter`. Docs-only.
