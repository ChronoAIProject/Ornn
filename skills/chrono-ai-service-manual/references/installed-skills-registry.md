# `~/.ornn/installed-skills.json` — registry contract

Companion to `SKILL.md` §0.5. This file specifies the schema, when to read, when to write, and the per-execution version-check protocol for the persistent installed-skills registry.

> **One file, one machine, every Ornn-aware agent.** `~/.ornn/installed-skills.json` is the **shared** source of truth across sessions and runtimes: a Claude Code session installs `csv-tools`, then a later Codex session on the same box reads the registry and knows it already has `csv-tools` at v1.3 — no re-install, no duplicate fetch. Treat the file as a contract; don't shape it to your runtime's quirks.

---

## 1. Where the file lives

| Platform | Path |
|---|---|
| macOS / Linux | `~/.ornn/installed-skills.json` |
| Windows | `%USERPROFILE%\.ornn\installed-skills.json` |
| Sandboxed runtime that can't write under `$HOME` | hold the same list in working memory and tell the user "the registry won't survive a session restart" |

If `~/.ornn/` does not exist, create it with mode `0700` (Unix). If `installed-skills.json` does not exist, create it as a literal `[]` the first time you append a record. Never write a different default — `null` and `{}` are not valid initial states.

---

## 2. Schema

A flat JSON array. Each element is an `InstalledSkillRecord`:

```jsonc
[
  {
    "name":             "chrono-ai-service-manual",            // required — Ornn skill name (kebab-case)
    "ornnGuid":         "1d9bfda2-dea8-4032-85bd-b0cbe1621684",// required — stable UUID-style id
    "installedVersion": "1.0",                                  // required — frontmatter version of the local copy
    "installedAt":      "2026-05-04T17:27:55Z",                 // optional — ISO 8601 UTC; set on first install + every upgrade
    "localPath":        "~/.claude/skills/chrono-ai-service-manual/",  // optional — directory you wrote files to (or omit if context-only)
    "isPinned":         false                                   // optional — when true, skip auto-update prompts; user explicitly locked the version
  }
]
```

### Field semantics

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Matches `metadata.name` in the skill's `SKILL.md` frontmatter. Kebab-case. Used for fast human lookup; the GUID is the canonical id. |
| `ornnGuid` | yes | The `data.guid` returned by `POST /skills` (creation), `GET /skills/:idOrName`, etc. Always use this as the lookup key when the registry has it. |
| `installedVersion` | yes | The frontmatter `version:` of the local copy, as a `<major>.<minor>` string. Compare against `items[0].version` from `/versions` to detect updates. |
| `installedAt` | no | ISO 8601 UTC timestamp. Set when you append the record; bump every time you upgrade the local copy. Useful when the user asks "when did I install this?". |
| `localPath` | no | Filesystem directory the skill files were written to. Omit for runtimes that load skills only into context (memory). When set, must end with a trailing slash. |
| `isPinned` | no | Default `false`. When `true`, the per-execution version check (§5) skips the upgrade prompt — the user has explicitly locked the version. Setting requires explicit user request; never auto-set. |

### What NOT to add

- **Do not store secrets** in the registry. No tokens, no API keys, no credentials. Anyone reading the file sees what's installed; they should not see anything sensitive.
- **Do not store skill content** (the SKILL.md, scripts/, etc.) — only metadata. The actual files live at `localPath` or in your runtime's context.
- **Do not store remote audit verdicts** — they're queryable from `/audit` endpoints and go stale fast.

### Forward compatibility

You may encounter records with fields not listed above (e.g. a future runtime added a `runtimeHint` field). **Preserve them on round-trip** — read, modify the fields you care about, write back without dropping unknowns.

---

## 3. When to read

The **first thing every Ornn-aware session does, before any other Ornn operation**, is read this file.

```pseudocode
on session start:
  if file exists:
    parse JSON; on parse error, surface to user, do not overwrite
  else:
    treat as empty []
  cache in memory for the session
```

**Re-read if** the file may have been mutated by another process (parallel sessions, a different agent, the user editing manually). A safe default: re-read at the start of any Ornn task. Cheap I/O.

---

## 4. When to write

Writes happen at four well-defined moments. Each one is a full file rewrite — read the file, mutate the array, write the whole thing back. Atomic-write best-practice (write to `installed-skills.json.tmp`, then rename) avoids torn writes.

| Event | What changes | Notes |
|---|---|---|
| Installed a new skill | Append a new record | Triggered by §2.1 step 3 (pull) or §2.1 step 5 (build + install). |
| Upgraded to a new version | On the matching record (by `ornnGuid`), bump `installedVersion` + `installedAt` | Triggered by §2.6 (pull a different version), §2.3 after publishing yourself, or the auto-update branch of §5. |
| Uninstalled / deleted a skill | Remove the matching record entirely | Triggered by §2.10 if the deleted version was the locally installed one and there's no fallback, or §2.11 (entire skill deleted). |
| User pinned a version | Set `isPinned: true` on the record | Triggered when the user explicitly says "stay on v1.2 — don't auto-prompt me". Never set this without explicit user intent. |

After each write, verify by re-reading. If the read returns malformed JSON, surface the error to the user and do not retry-loop — something else is interfering with the file.

### What about uninstall when the skill is still present remotely?

If the user "uninstalls" a skill (i.e. removes it from their local environment) but the skill remains on the Ornn registry, just remove the record. Don't call any Ornn delete endpoint — local uninstall is purely client-side.

---

## 5. Per-execution version check (the protocol)

**Before you actually execute an installed Ornn skill** on the user's task, check whether a newer version exists. One API call:

```bash
nyxid proxy request ornn-api \
  "/api/v1/skills/<name-or-guid>/versions" \
  --method GET --output json
```

For public skills you can drop the auth and call the same endpoint anonymously (HTTP form: `curl https://ornn.chrono-ai.fun/api/v1/skills/<name>/versions`).

Response: `{ items: [{ version, skillHash, createdOn, isDeprecated, deprecationNote, releaseNotes, ... }, ...] }` sorted newest-first. Compare `items[0].version` to the `installedVersion` on the matching registry record:

| Outcome | Action |
|---|---|
| Same version | Execute as-is. |
| Newer version available | Tell the user `"Skill <name> has a newer version <X.Y> (you have <A.B>). Release notes: <releaseNotes>. Update? (y/n)"`. If yes, re-fetch the package (§2.1 step 3 in `SKILL.md`), overwrite the local copy, bump `installedVersion` + `installedAt`, then execute. If no, execute the installed version. |
| Your installed version has `isDeprecated: true` (look up the matching item in `items`) | Warn the user with `deprecationNote`, recommend updating before executing. |
| Skill 404s | The skill was deleted or hidden from you. Tell the user; if they agree, remove the record from the registry. Otherwise leave the record (with a note) — local copy is still usable. |

**Skip the version check when the matching record carries `isPinned: true`.** Pinning means "don't ask me again about updates."

### When to defer the version check

- The user said "just run it, don't check for updates."
- The skill execution is on a hot path and adding an HTTP round-trip would break the user-perceived latency budget.
- The Ornn API is unreachable. Fall back to the locally-installed version, surface the failure to the user, do not retry-loop.

---

## 6. Audit-risk fan-out

If the skill is tied to a NyxID admin service (a "system skill" — `isSystemSkill: true`), the audit pipeline can also notify you mid-session via `GET /api/v1/notifications` (see `SKILL.md` §2.13). Treat any `audit.risky_for_consumer` notification as a hard signal to **stop using the skill**, surface it to the user, and ask before continuing — even if your installed version was previously fine. The audit verdict applies to the version you have installed, and the registry record's `installedVersion` is the field that links the notification to your local copy.

You don't need to write anything to the registry on these notifications — they're a side-channel. But if the user agrees to upgrade in response, run the standard upgrade path (§5).

---

## 7. Multi-agent / multi-runtime coexistence

Two agents on the same machine (e.g. Claude Code and Codex) sharing the same `~/.ornn/installed-skills.json` will read each other's installs. That's the design — the registry is the substrate.

But two agents writing simultaneously can race. Mitigations:

- **Atomic write** (write-to-temp-then-rename) is enough for most cases.
- If you observe a corrupted file (parse fails), surface to the user and ask before overwriting. They may want to keep the half-written state for forensics.
- Do not attempt cross-process locking — runtimes vary too much.

---

## 8. Examples

### Empty registry, just installed `chrono-ai-service-manual`

```jsonc
[
  {
    "name": "chrono-ai-service-manual",
    "ornnGuid": "<guid-from-POST-/skills>",
    "installedVersion": "1.0",
    "installedAt": "2026-05-04T17:27:55Z",
    "localPath": "~/.claude/skills/chrono-ai-service-manual/"
  }
]
```

### Two skills, one pinned

```jsonc
[
  {
    "name": "chrono-ai-service-manual",
    "ornnGuid": "1d9bfda2-dea8-4032-85bd-b0cbe1621684",
    "installedVersion": "1.0",
    "installedAt": "2026-05-04T17:27:55Z",
    "localPath": "~/.claude/skills/chrono-ai-service-manual/"
  },
  {
    "name": "csv-tools",
    "ornnGuid": "skl_01HXY...",
    "installedVersion": "1.2",
    "installedAt": "2026-04-30T09:14:21Z",
    "localPath": "~/.claude/skills/csv-tools/",
    "isPinned": true
  }
]
```

### Context-only install (no `localPath`)

```jsonc
[
  {
    "name": "chrono-ai-service-manual",
    "ornnGuid": "1d9bfda2-dea8-4032-85bd-b0cbe1621684",
    "installedVersion": "1.0"
  }
]
```

`installedAt`, `localPath`, and `isPinned` are all optional — when omitted, treat them as "unknown" / "memory-only" / "false" respectively.
