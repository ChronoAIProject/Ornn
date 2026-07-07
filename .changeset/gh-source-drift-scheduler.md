---
"ornn-api": minor
---

Add the scheduled GitHub source drift-check job (#1176): a multi-pod-safe Agenda scheduler periodically probes every GitHub-sourced skill's upstream (coalescing skills that share a repo/ref into one request), records whether it has drifted, and notifies the owner when a source repo becomes unreachable. Cadence is driven by the `sourceSync.pollSchedule` setting; the job honors GitHub rate limits and never lets one skill's failure abort the run. It only records drift state — automatic re-publish is a later change.
