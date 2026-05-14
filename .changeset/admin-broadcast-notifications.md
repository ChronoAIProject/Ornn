---
"ornn-api": minor
"ornn-web": minor
---

Admin broadcast notifications (#500). Admins can now author bilingual (EN + ZH) markdown notifications from `/admin/broadcasts` that land in every user's `NotificationBell` inbox; edits propagate to all users, hard delete clears the message and cascades read receipts. Backend exposes admin-guarded CRUD at `/api/v1/admin/broadcasts/*` and merges broadcasts into the existing `/api/v1/notifications` feed under a `source: "broadcast"` discriminator, with per-user read state stored in a separate `broadcast_read_receipts` collection.
