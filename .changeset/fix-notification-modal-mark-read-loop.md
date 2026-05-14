---
"ornn-api": patch
"ornn-web": patch
---

Fix click-to-popup broadcast notification (#502) crashing with React error #185 (Maximum update depth exceeded). The mark-read effect inside `NotificationDetailModal` re-fired on every parent rerender because the parent passed an inline arrow callback. Modal now stores the callback in a "latest ref" and tracks the last marked id, so mark-read fires exactly once per opened broadcast no matter how the parent rerenders.
