---
"ornn-web": patch
---

Make `NotificationDetailModal` source-agnostic so clicking a quota notification (or any non-broadcast row without a deep-link) opens it in place instead of silently marking it read. Closes #532.

Quota credit notifications (`quota.credits_granted`) are emitted without a `link` by design — the API service comment explicitly notes there's no good deep-link target — so the `cursor-pointer` row on `/notifications` and the bell popover looked clickable but did nothing visible. Long admin notes (e.g. `Note: Redeemed code Y69H…`) were truncated by the row width with no way to read them.

The modal now branches on `source`: broadcasts keep their bilingual markdown rendering; user-source rows render `title` + plain-text `body` with a category-resolved tag chip (Audit / Quota). The category labels reuse the same hardcoded map that `NotificationsPage` already shipped — separate follow-up if/when we localize them. Both surfaces (full page + bell) now route non-broadcast rows through the modal when the row has body content but no link; rows with a link still navigate (audit deep-links continue to work).
