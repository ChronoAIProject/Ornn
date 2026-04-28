---
version: 1.0.0
lastUpdated: 2026-04-28
---


# Ornn vs. raw GitHub

Plenty of teams already host their AI agent skills as `SKILL.md` files in a GitHub repo. That works. It's free, you already know how to use it, and your agent can curl the raw URL. This page is about the line where "just use GitHub" stops scaling and Ornn starts paying for itself.

## TL;DR

| | GitHub repo | Ornn |
|---|---|---|
| **What it is** | A code host. Stores files. | A skill-lifecycle API. Stores files plus everything around them. |
| **Discovery** | `gh search`, your bookmarks, README | Keyword + semantic search across the registry, with caller-visibility scoping |
| **Versioning** | Git tags / branches — yours to design | First-class skill versions; `GET /skills/:idOrName/versions`, `diff/:from/:to` |
| **ACLs** | Public, or paid private repo (per-repo) | Per-skill ACL: private / shared-with-users / shared-with-orgs / public — without paying per-repo |
| **Identity** | GitHub identity, fine for code review, not the right shape for "this user inside this org" | NyxID OAuth — real user + org membership at the API edge |
| **Trust signal** | None — you trust the author | Audit verdict per version, with consumer notifications on yellow / red |
| **Sandbox** | None — agent runs the code itself | First-party (chrono-sandbox), playground UI for try-before-install |
| **Programmatic agent API** | Hand-rolled (parse README, raw URL, custom auth) | One HTTP / MCP API — search, pull, execute, build, upload, share |
| **Best for** | Public, code-first skills with no privacy or org needs | Multi-user, multi-tenant, audit-aware skill operations |

## When raw GitHub is fine

- You're publishing a single open-source skill and the README + raw URL is enough.
- You don't need to share the skill with specific people — public is fine.
- Your agent's "install" step is `curl raw.githubusercontent.com/...` and you're happy with that.
- You don't need search beyond `gh search code`.
- You don't need an audit verdict; "trust the author" is good enough.

If all five are true, GitHub is the cheapest path. Use it.

## When Ornn pays for itself

- **Multi-tenant.** You have skills that should be visible to one organisation but not another. GitHub solves this by paying per private repo or running an organisation; Ornn solves it with per-skill ACLs.
- **Mixed trust.** Some skills public, some private to the team, some shared with one external partner. GitHub forces you to model this as separate repos / orgs; Ornn lets you flip a switch on each skill.
- **Audit + notifications.** You care about whether a skill is risky and you want consumers to be told automatically. GitHub doesn't do this; Ornn does it as a first-class flow.
- **Programmatic agent loop.** Your agent is supposed to discover and pull skills *at runtime*. With GitHub, that's `gh api` calls + raw-URL parsing + your own caching. With Ornn, it's one call per verb and a stable schema.
- **Sandbox before install.** You want to let users try a skill in a controlled runtime before they take it. GitHub doesn't do this; Ornn's playground does.
- **Telemetry.** You want pull counts, execution success rates, source breakdown (api / web / playground). GitHub gives you stars and clones; Ornn gives you the metrics that matter for skills specifically.

## They aren't mutually exclusive

`POST /skills/pull` imports a public GitHub repo as an Ornn skill. The skill remains linked to its GitHub source so `POST /skills/:id/refresh` can re-pull on demand. This is the recommended pattern for teams who want to:

- Author + version-control skill source in git (the dev experience they already know).
- Distribute + audit + ACL through Ornn (the operational story GitHub doesn't have).

Use git for source-of-truth, Ornn for runtime distribution and trust.
