---
"ornn-api": minor
"ornn-web": minor
---

Admin settings reorganization. Trims admin Settings from 11 sections to 9 by folding domain-specific knobs into the section that actually owns them:

- **Quota Defaults → Playground + Skill Generation.** The standalone `quotaDefaults` section is gone. `defaultMonthlyQuota` lives on each surface's own section.
- **Other Services → NyxID Integration.** The standalone `services` section is gone. `chronoStorageUrl`, `chronoStorageBucket`, `chronoSandboxUrl` live on the `integrations/nyxid` section.
- **Telemetry → PostHog.** Renamed UI title and API public path (`/admin/settings/telemetry` → `/admin/settings/posthog`). Section id stays `telemetry` so existing Mongo rows keep their `_id`.
- **Extras → Service Binding List Configuration.** UI label only.

Operator action on redeploy: re-enter `defaultMonthlyQuota` under Playground + Skill Generation, and the chrono-storage / chrono-sandbox endpoints under NyxID Integration. The previous `quotaDefaults` and `services` Mongo rows become orphans — safe to leave or drop.

Closes #302.
