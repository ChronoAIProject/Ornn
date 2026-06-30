---
"ornn-web": minor
---

The skill detail install card gains a "via plugin (Claude Code Marketplace)" tab. For any public skill on a deployment with the GitHub mirror enabled, it shows the two copyable `/plugin marketplace add <owner>/<repo>` + `/plugin install <skill>@<repo>` commands, plus the shared auto-update-OFF note. Private skills and mirror-off deployments get a clear "available once public" / "mirror not configured" hint instead of a command that won't resolve.
