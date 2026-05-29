---
"ornn-web": patch
---

The All-versions modal now drops a deleted version row immediately, and the result toast renders above any open modal (#699).

Two distinct issues piled up after a version delete:

1. **Stale list**: `useDeleteSkillVersion` invalidated `[SKILLS_KEY, idOrName]`, `[SKILLS_KEY]`, `[MY_SKILLS_KEY]`, and per-version audit caches, but not `[SKILL_VERSIONS_KEY, idOrName]` — the very query the All-versions modal subscribes to. So the deleted row stayed visible, and a second click on its delete button hit the backend with `SKILL_VERSION_NOT_FOUND`. Added the missing invalidation.

2. **Obscured toast**: `ToastContainer` portal and the `Modal` portal both sit at `z-50`, so when both are mounted the toast is rendered behind the modal overlay and the success/error feedback for an in-modal action (delete or deprecate from the All-versions modal) becomes dim and unreadable. Bumped `ToastContainer` to `z-[60]` so toasts always sit above modals — single source of truth, no per-call escape hatches needed.
