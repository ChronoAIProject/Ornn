---
"ornn-api": minor
"ornn-web": minor
---

Separate read and write access (drop the `read_write` level) and show edit UI to write-grantees.

The combined `read_write` grant level is renamed to `write`: each grant is now `read` or `write` (a `write` grant implies read), with no combined label. Existing `read_write` grants migrate to `write` automatically at boot — non-disruptive and rollback-safe.

This also fixes a bug where a user with **write** access saw no edit controls: the skill detail page (Edit button, inline file editor, Save) and the edit page now reveal content-editing to write-grantees, not just the owner, while admin actions (permissions, transfer, delete, visibility) remain owner/admin-only.
