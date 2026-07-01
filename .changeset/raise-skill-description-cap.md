---
"ornn-api": patch
"ornn-web": patch
---

Raise the skill frontmatter `description` cap from 1024 to 1536 characters, aligned with Claude Code's skill-listing truncation limit (`skillListingMaxDescChars`, default 1536) — so an author can write a description as rich as the runtime actually uses for auto-invocation routing, instead of relying on `skip_validation` to smuggle a longer one past the schema. Skillset descriptions are unchanged (still 1024).
