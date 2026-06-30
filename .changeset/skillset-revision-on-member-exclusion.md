---
"ornn-api": patch
---

Exported skillsets now bump their revision when a member skill is excluded or re-included via a visibility change, so Claude Code picks up the update. Previously a member going private was correctly dropped from the bundle and noted in the README, but the skillset revision stayed the same — and since Claude Code detects plugin updates only by the version string, installed clients kept the stale copy (including the now-private member's files). The reactive revision bump now compares the PUBLIC-resolvable member subset (exactly what gets exported), so a member's visibility flip moves the snapshot and bumps the minor — in addition to the existing member-version-increment trigger. The re-exported plugin.json and marketplace entry carry the new revision. No spurious churn: an unchanged public subset still produces no bump, and a skillset still carrying a pre-fix all-members snapshot self-corrects with a single one-time bump on its first member event.
