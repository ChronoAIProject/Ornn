---
"ornn-web": patch
---

fix(web): replace browser-native unsaved-changes confirm with a styled Modal (#281).

Navigating away from a settings section with unsaved changes used to pop Chrome's native `window.confirm` dialog ("ornn.ornn-cluster.local says — You have unsaved changes in this section. Discard them?"). It was the only place in the SPA that bypassed the Forge Workshop design system. `UnsavedChangesGuard` now renders the project's `<Modal>` with **Cancel** and **Discard changes** buttons. The `beforeunload` tab-close prompt stays raw — that one's owned by the OS shell and can't be styled from the page.
