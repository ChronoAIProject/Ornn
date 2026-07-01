---
"ornn-api": minor
---

Add unattended auto-publish for drifted GitHub-sourced skills (#1177): when the `sourceSync.autoPublish` switch is on, the scheduled drift check now automatically re-pulls and publishes a new version of any skill whose upstream moved — no manual trigger. The auto path runs the same validation as a manual refresh, refuses to publish when the `SKILL.md` version wasn't bumped (surfacing "changed but not versioned" instead of clobbering the immutable version), records the new version under a dedicated system actor, and notifies the owner on both success and refusal. Ships off by default.
