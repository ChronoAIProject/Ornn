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
    // External services + skill format + observability pipeline.
    id: "architecture",
    title: "Architecture",
    repoRelPath: "docs/ARCHITECTURE.md",
    maxTokens: 2_400,
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
    // Normative /api/v1 contract — envelope, errors, paths, auth.
    id: "conventions",
    title: "API Conventions",
    repoRelPath: "docs/CONVENTIONS.md",
    maxTokens: 2_600,
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
