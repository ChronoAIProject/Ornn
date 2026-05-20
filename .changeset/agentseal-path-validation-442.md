---
"ornn-api": patch
---

Harden the AgentSeal subprocess (#442). Two defensive changes, both small.

**Boot-time path validation.** `AgentSealScanner`'s constructor now refuses `python` / `script` config values that aren't absolute paths to existing regular files. Closes a lateral-movement gap: if scanner config ever sourced from a less-trusted place (admin-editable UI, env that picks up `PATH`), `spawn("python", ...)` would silently resolve against `$PATH` and let an attacker swap in any binary they could plant on the search path. Validation only fires when `enabled: true`, so dev/test envs that don't have agentseal installed can boot fine. New `AGENTSEAL_ENABLED=false` env flag toggles the whole scanner (default `true`).

**Unref child after kill.** When the subprocess hits the timeout and we send SIGTERM / SIGKILL, we now also call `child.unref()` so the killed process can no longer keep the API event loop alive during shutdown. Previously, a scanner mid-flight when the API received SIGTERM could delay graceful shutdown by up to `timeoutMs + 1s`.

Tests: 6 new assertions on the path validator (relative rejected, missing rejected, directory rejected, disabled skips validation, happy path constructs, helper unit-tested). Existing subprocess tests adjusted to use a real on-disk dummy script.
