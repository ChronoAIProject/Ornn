# Ornn vs. Vercel `skills.sh`

Both projects host AI agent skills. They solve different problems. This page is about when each one fits.

## TL;DR

| | `skills.sh` (Vercel) | Ornn |
|---|---|---|
| **Primary consumer** | Human developer browsing the directory | Agent calling the API |
| **Surface** | Static-style directory + GitHub-backed pages | HTTP / MCP API + secondary web UI |
| **Skill format** | Hosted GitHub repos rendered as listings | Portable ZIP package (SKILL.md + scripts + metadata) |
| **Authentication** | None — public listings | NyxID OAuth (real user / org identity) |
| **Authorization** | None | Per-skill ACL (private / shared with users / shared with orgs / public) |
| **Trust signal** | None | Audit verdict (green / yellow / red) attached to every version, with consumer notifications |
| **Sandbox** | Vercel Functions / external | First-party (chrono-sandbox), playground UI |
| **Best for** | Discoverability, marketing, quick eyeball-the-skill | Programmatic agent lifecycle, enterprise use |

## What `skills.sh` is good at

A polished directory experience. Easy to browse, easy to bookmark, easy to send a link to a teammate. Vercel's strength is human-facing developer-tooling polish. If a human is the consumer — they want to scan listings, copy a snippet, run something quickly — `skills.sh` is a great fit.

It's also free. The skill itself usually lives in a public GitHub repo, which is fine for open-source skills.

## What Ornn is good at

Everything an agent does *after* it has decided to use a skill, plus identity-aware operations:

- **Programmatic listing**: keyword + semantic search via one HTTP call.
- **Programmatic install**: fetch the package as JSON in one call (`GET /skills/:idOrName/json` returns `{ files: [{ path, content }] }` so an agent can inject files into context immediately).
- **Programmatic publish**: SSE-streamed AI generation. An agent can generate a brand-new skill, validate it, and publish it without leaving its loop.
- **Identity-aware sharing**: share a private skill with one user, with an organisation, with a list of organisations. Real ACLs, not just public/private.
- **Audit verdict + notifications**: every skill has a verdict. Consumers of a yellow / red skill are notified by NyxID — they don't have to poll the directory.
- **Execution telemetry**: per-skill pull counts (broken down by source: API / web / playground) and execution latency / success rate.

## When to use which

| You are… | Use |
|---|---|
| A human looking for a skill to copy and adapt | `skills.sh` |
| Publishing a public skill that needs nothing more than a Markdown listing | `skills.sh` |
| Building an AI agent that needs to programmatically discover, pull, and execute skills | **Ornn** |
| An organisation that needs to keep skills private to specific people / orgs | **Ornn** |
| An organisation that needs an audit-and-notification trail when a skill flips risky | **Ornn** |
| A team with mixed trust requirements — some skills public, some private, some org-scoped | **Ornn** |

## Federation isn't impossible

Ornn's `POST /skills/pull` already imports a public GitHub repo as an Ornn skill. Importing a `skills.sh` listing reduces to importing the GitHub repo it points at. If `skills.sh` exposes a programmatic listing endpoint we'd build a thin sync that mirrors public listings into Ornn so they can flow through the agent-API contract — but that's a separate workstream, not a substitute for the comparison above.
