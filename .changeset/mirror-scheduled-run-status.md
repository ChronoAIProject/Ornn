---
"ornn-api": minor
"ornn-web": minor
---

Surface last-run status of the scheduled mirror reconcile (#475). Both the GitHub mirror settings page and the legacy mirror dashboard now show whether the most recent *scheduled* fire succeeded, failed (with the error message), is currently running, or hasn't happened yet — sourced from Agenda's persisted recurring-job doc so the view is consistent across pods and survives restarts. The previous in-process `lastReconcile` block on `GET /admin/mirror/status` is replaced with a new `scheduledRun` block. Manual `Reconcile now` clicks from the dashboard still work but do not appear in this widget; the 409 "already running" guard on the manual reconcile endpoint is unchanged.
