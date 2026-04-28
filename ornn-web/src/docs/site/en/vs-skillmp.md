# Ornn vs. SkillMP

SkillMP and Ornn both name themselves around AI agent skills. They are not the same kind of product. Knowing which one fits your problem is mostly about knowing whether you're shopping or building.

## TL;DR

| | SkillMP | Ornn |
|---|---|---|
| **Shape of product** | Marketplace — human-facing directory of skills with creator pages, ratings, browse-style discovery | API layer — agents call Ornn directly to manage their own skill lifecycle |
| **Primary consumer** | A human picking a skill to install | An AI agent at runtime |
| **Authentication** | Marketplace account | NyxID OAuth — real org / user identity at the API edge |
| **Per-skill ACLs** | Public / "premium" listings; the skill itself is the unit, not the recipient | Private, shared-with-users, shared-with-orgs, public — recipient is a real identity |
| **Trust signal** | Ratings and creator reputation — social | Audit verdict (`green` / `yellow` / `red`) per version + consumer notifications when a skill flips risky |
| **Build / publish flow** | Upload a skill, fill in a listing, wait for marketplace approval | Programmatic: `POST /skills`, `POST /skills/pull`, or `POST /skills/generate` (SSE) |
| **Programmatic API** | Limited or absent | First-class — every operation is an HTTP / MCP call |
| **Best for** | Browsing, paying for, or selling discrete skills | Building agentic systems whose skill management happens in code, not in a UI |

## What SkillMP is good at

Marketplaces are good at three things: **discovery**, **monetisation**, **social proof**. If you want to find a skill the way you find a Chrome extension, SkillMP-style products are the right shape. If you want to sell access to your skill or earn from usage, you need something with a billing / rev-share story baked in. If you trust a 4.8-star rating with 12k installs more than a verdict your own audit pipeline produced, marketplaces dominate.

## What Ornn is good at

Everything that happens *during* an agent's runtime, plus identity-aware operations:

- **Search → pull → execute** is one HTTP call each. The agent never leaves its loop.
- **Per-skill ACLs are real ACLs**, not honor-system "private listings". Sharing a private skill with `org_xyz` means everyone in `org_xyz` (resolved through NyxID) can see it; nobody else can.
- **Audit verdict is structured data**, not a star rating. Consumers of a skill that flips to `yellow` / `red` get a `audit.risky_for_consumer` notification automatically. Owners get `audit.completed` on every run.
- **AI-native publishing**. Generate a skill from a prompt or from existing source code. Stream the output. Validate it against the skill format. Upload it. All in code.

## When to use which

| You are… | Use |
|---|---|
| A solo builder wanting your skill to be discovered by humans | SkillMP-style marketplace |
| A skill author wanting to monetise installs / usage | SkillMP-style marketplace |
| Building an agent that needs to call out to dozens of skills at runtime | **Ornn** |
| Operating skills inside an enterprise where org boundaries matter | **Ornn** |
| Treating skills as part of your CI/CD pipeline (audit-on-publish, deprecate-on-replacement) | **Ornn** |

## Federation isn't impossible

If a SkillMP-style marketplace exposes a programmatic listing API, Ornn can mirror that listing locally and serve the agent-API contract over it. The public skill content is the federation primitive — once Ornn knows where to fetch the bytes, the agent calling Ornn doesn't care whether the original lived on Ornn or on a marketplace. That is a separate workstream and not a substitute for the comparison above.
