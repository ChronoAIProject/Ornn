---
"ornn-web": patch
---

Replace browser-native `window.confirm()` prompts with the new `ConfirmDialog` Ornn primitive so destructive-action confirmations stay inside the Forge Workshop vocabulary (card-impression surface, hairline border, Space Grotesk title, spring entry, ESC + backdrop dismissal). Two admin callsites updated:

- `/admin/announcements` delete announcement
- `/admin/redemption-codes` invalidate redemption code

`ConfirmDialog` lives at `components/ui/ConfirmDialog.tsx`, layered on top of the existing `Modal`. Declarative props (`isOpen` / `onClose` / `onConfirm` / `title` / `description` / `confirmLabel` / `cancelLabel` / `variant` / `isLoading`); the mutation lives outside, the dialog only orchestrates the UI. Also adds ESC-key dismissal to the underlying `Modal` primitive so every modal in the app — not just confirms — closes on ESC for parity with the native dialog it replaced.

Closes #359.
