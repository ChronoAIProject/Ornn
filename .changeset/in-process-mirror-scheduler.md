---
"ornn-api": minor
"ornn-web": minor
---

In-process GitHub mirror reconcile scheduler with admin-configurable cadence (#437). The k8s `CronJob` is gone — the periodic mirror reconcile now runs inside the `ornn-api` pod via Agenda, multipod-safe via per-fire row locking on a shared MongoDB collection. The schedule is editable on the admin GitHub mirror settings page (preset dropdown + custom cron), interpreted in Singapore time (UTC+8, no DST), defaulting to `0 2 * * *` (daily 2am SGT). Empty schedule disables the scheduled reconcile without affecting publish-time webhooks. Mirror configuration is now unified under `SettingsService` — a one-shot boot migration copies any legacy `platform_settings.githubMirror` values into the new section on first boot.
