---
version: 1.0.0
lastUpdated: 2026-04-29
---


# Quick Start: the Agent Manual

This is for **AI agents** (and the developers wiring them up). If you're a human looking to manage skills in the GUI, see the [Web Users quick start](/docs?section=qs-web-user) instead.

## What the agent manual is

The **agent manual** is itself an Ornn skill — the operational contract the agent loads to know how to use Ornn. Once the manual is in context, the host agent can search / pull / execute / build / upload / share / audit / link-to-GitHub / sync skills end-to-end without further onboarding. No model fine-tuning, no bespoke tool bindings — just one skill loaded into the agent's system context.

The manual ships in two transport-specific variants — pick the one that matches how your agent talks to Ornn:

| Variant | Skill name | Transport |
|---|---|---|
| **NyxID CLI** | `ornn-agent-manual-cli` | `nyxid proxy request ornn-api …` |
| **Direct HTTPS** | `ornn-agent-manual-http` | `curl -H "Authorization: Bearer $TOKEN" …` |

Both are published as **system skills** tied to the `ornn-api` NyxID service — they're forced public, discoverable platform-wide, and authoritative.

## What's inside

Each manual ships as one Ornn skill with two files:

- **`SKILL.md`** — the agent's runtime instructions. Loads workflow recipes for every common operation: find or build a skill, update visibility, publish a new version, trigger an audit, view audit history, pull a different version, **diff two versions**, check analytics, bind to a NyxID service, **delete or deprecate a version**, delete a skill, find skills, pull notifications, **link to GitHub or trigger a sync**. Thirteen self-contained use cases.
- **`references/api-reference.md`** — exhaustive per-endpoint catalogue. Every method + path, request body schema, response shape, every error code with its HTTP mapping, auth + authorization rules. Pull this into context whenever your agent needs the full contract for an endpoint.

## How to access it

The agent (or the developer wiring it up) pulls the manual the same way it pulls any other skill — through the registry. Three fetch paths, pick whichever fits your environment:

### Option A — via the NyxID CLI *(preferred when `nyxid` is installed)*

```bash
nyxid proxy request ornn-api \
  /api/v1/skills/ornn-agent-manual-cli/json --output json
```

### Option B — direct HTTPS with a NyxID bearer token

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json
```

### Option C — anonymous *(system skills are always public)*

```bash
curl https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json
```

The response shape is `{ data: { name, description, metadata, files: { "SKILL.md": "…", "references/api-reference.md": "…" } } }` — every file inline.

## What the agent does with it

The agent's runtime should:

1. **Install the manual locally** when it has a skills directory (e.g. `~/.claude/skills/ornn-agent-manual-cli/`). Otherwise hold the contents in working context for the rest of the session.
2. **Append a record to `~/.ornn/installed-skills.json`** — the cross-session install registry every Ornn-aware agent maintains. Schema: `{ name, ornnGuid, installedVersion, installedAt, localPath?, isPinned? }`. The manual itself documents this contract in §0.5.
3. **Re-check for updates** before each Ornn operation by listing versions and comparing to the installed version. Bump `installedVersion` + `installedAt` when overwriting to a newer release.
4. **Load `SKILL.md` and `references/api-reference.md` into context** for any Ornn-related task.

Once those four steps run, the agent is wired up — every subsequent Ornn operation is one API call against a documented contract.

## Find the system skill in the GUI

You can also discover the manual through the registry — `ornn-agent-manual-cli` and `ornn-agent-manual-http` both surface on the **System Skills** tab of the [registry](/explore). The detail page renders the install-prompt builder (the same prompt you'd inject into your agent) plus the full package preview.
