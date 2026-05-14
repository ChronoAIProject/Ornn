---
"ornn-api": minor
"ornn-web": minor
---

Targeted broadcasts + click-to-popup markdown viewer (#502). Builds on #500. Admins can now choose between broadcasting to all users (existing behaviour) and targeting specific users by email. Recipients are immutable after create — edits only touch the bilingual title/body, deletes still cascade read receipts. End-user side: clicking a broadcast notification in the bell or `/notifications` page now opens a modal that renders the full bilingual markdown body (existing audit / quota notifications keep their navigate-to-link behaviour). The merged `/notifications` feed, unread count, mark-read, and mark-all-read all transparently filter targeted broadcasts so non-recipients never see them.
