---
"ornn-web": patch
---

`useNotifications` now polls on the same 30s interval as the unread-count query, so the bell dropdown stays in sync with the badge (#728).

Background: the bell badge subscribes to `useUnreadNotificationCount` (polled every `UNREAD_POLL_MS` = 30s) and the dropdown list to `useNotifications` (no `refetchInterval`, only `staleTime: 10_000`). When a new targeted broadcast lands, the count poll ticks to `1` and the badge updates — but `useNotifications` only re-fetches on remount/invalidation, so an open (or just-mounted-but-still-fresh) dropdown showed the pre-broadcast list. Users saw "1 unread" + a list that didn't contain it.

Fix: add `refetchInterval: UNREAD_POLL_MS` to `useNotifications` so the two queries tick together. `refetchIntervalInBackground: false` mirrors the count query — no traffic when the tab is hidden. `staleTime` stays at 10s so quick remounts (e.g. dropdown toggle) still serve cached data without an extra round-trip.
