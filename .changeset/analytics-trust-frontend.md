---
"ornn-web": minor
---

frontend: PostHog browser SDK + AgentSeal trust badge.

#252 — wires PostHog as Ornn's product analytics layer in `ornn-web`. Browser SDK installs at app root via a new `PostHogProvider`; auto-pageview is on, SPA navigation is captured through React Router's `useLocation`, and `identify` runs on every NyxID login (and tab-restore) with email / displayName / isAdmin traits. A GDPR-compliant cookie consent banner ships on by default — analytics stay opted out until Accept is clicked, and revoking consent stops session replay + resets the distinct id. Custom events emit at the listed call sites: `skill.created` / `skill.published` / `skill.version_published` (every create + version publish path), `playground.run` / `.completed` / `.failed`, `skill_gen.started` / `.completed`, `model.selected`, `login.completed`. Config (`POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`) is runtime-injected via `window.__ORNN_CONFIG__` — empty values disable analytics entirely so previews and local dev keep working without a live project.

#253 — adds the AgentSeal trust badge to the skill detail page. Reads `agentsealScan = { score, findings, scannedAt, version }` off the resolved skill version, color-codes the badge across five bands (excellent / high / medium / low / critical) on the Industrial Forge palette (DESIGN.md mineral state tokens — never raw consumer greens / reds), and surfaces an expandable findings list sorted worst-first under the badge. Unscanned skills get a `Not scanned` tile with the same silhouette so the right-rail spacing stays consistent.
