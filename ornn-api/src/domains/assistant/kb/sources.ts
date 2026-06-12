/**
 * Build-time source manifest for the Ornn Assistant knowledge base (#970).
 *
 * Declares WHICH repo docs feed the grounding digest, in priority order,
 * with per-source token caps and (where a doc is mostly irrelevant to
 * Q&A) a heading allow-list so only the useful sections survive.
 *
 * This manifest is consumed ONLY by `scripts/build-assistant-kb.ts` at
 * build time — paths are relative to the repo root and the files don't
 * ship in the runtime container. The runtime loads the produced artifact,
 * not these sources. Curation policy lives here so adding/retuning a
 * source is a one-line data change, not code.
 *
 * Ground rules:
 *   - Docs only. Never list source code, configs, or anything that could
 *     carry secrets — the digest is fed verbatim to a model and streamed
 *     to users.
 *   - Order = priority. Earlier sources win the budget if the global cap
 *     bites; the assistant's identity ("what is Ornn") leads.
 *
 * @module domains/assistant/kb/sources
 */

/** A planned source: where to read it and how much of it to keep. */
export interface KbSourceSpec {
  readonly id: string;
  readonly title: string;
  /** Path relative to the repo root. */
  readonly repoRelPath: string;
  /** Per-source token cap applied after section extraction. */
  readonly maxTokens: number;
  /** Optional markdown heading allow-list (exact heading text). */
  readonly headings?: ReadonlyArray<string>;
}

/**
 * Curated, priority-ordered manifest. Tuned so the sum of caps lands a
 * little under the default 18k budget, leaving headroom for the global
 * clamp — see `scripts/build-assistant-kb.ts`.
 */
export const KB_SOURCE_MANIFEST: ReadonlyArray<KbSourceSpec> = [
  {
    // The single best "what is Ornn / why / how it works" doc.
    id: "readme",
    title: "Ornn — Overview (README)",
    repoRelPath: "README.md",
    maxTokens: 2_800,
  },
  {
    // Positioning only — skip the release-process / deploy boilerplate.
    id: "claude-positioning",
    title: "Product Positioning",
    repoRelPath: "CLAUDE.md",
    maxTokens: 1_500,
    headings: ["Product Positioning"],
  },
  {
    // User-relevant architecture only: what Ornn is, the high-level
    // external-service overview, and the skill format. The internal infra
    // sections (PostHog/telemetry internals, env-var catalogs, internal
    // request-header names like X-NyxID-*/X-Ornn-Caller-*, the user
    // directory) are EXCLUDED via this allow-list — they're needless
    // internal-recon surface for an assistant any authenticated user can
    // query (security review #970, finding #1).
    id: "architecture",
    title: "Architecture",
    repoRelPath: "docs/ARCHITECTURE.md",
    maxTokens: 1_800,
    headings: ["Project Overview", "External Services", "Skill Format"],
  },
  {
    // The authoritative agent contract: search → pull → execute → build →
    // upload → share over HTTP. The most-asked "how do I …" answers live
    // here. HTTP manual is the live path (no CLI shipped yet).
    id: "agent-manual-http",
    title: "Using Ornn from an AI Agent (HTTP API)",
    repoRelPath: "skills/ornn-agent-manual-http/SKILL.md",
    maxTokens: 5_500,
  },
  {
    // User-relevant /api/v1 contract sections only: response/error
    // envelope, URL structure, HTTP semantics, query params, SSE. The
    // §5 Authentication section carries an INTERNAL transport note
    // (`X-NyxID-*` proxy headers, "not part of the public contract"), and
    // §7–§12 are deprecation/caching/observability/architecture
    // internals — all EXCLUDED via this allow-list so the same internal
    // header names the architecture source dropped don't re-enter the
    // digest here (security review #970, finding #1).
    id: "conventions",
    title: "API Conventions",
    repoRelPath: "docs/CONVENTIONS.md",
    maxTokens: 2_600,
    headings: [
      "1. Response & error format",
      "2. URL structure",
      "3. HTTP semantics",
      "4. Query parameters",
      "6. SSE streaming",
    ],
  },
  {
    // Visual spec is mostly irrelevant to Q&A; keep only the opening
    // philosophy/overview so "what does Ornn look/feel like" has an anchor.
    id: "design-overview",
    title: "Design System (Overview)",
    repoRelPath: "docs/DESIGN.md",
    maxTokens: 700,
    headings: ["Product Context", "Design Thesis"],
  },
];
