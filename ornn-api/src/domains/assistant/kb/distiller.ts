/**
 * Knowledge-base distillation (#970).
 *
 * A *distiller* turns a set of raw repo documents into a single,
 * size-budgeted grounding digest for the Ornn Assistant. v1 ships
 * {@link DeterministicKbDistiller} — pure, repeatable curation:
 *
 *   1. optionally extract only the relevant markdown sections of a doc
 *      (so e.g. CLAUDE.md contributes its "Product Positioning" section,
 *      not its release-process boilerplate),
 *   2. clip each doc to its per-source token cap,
 *   3. render each as a titled block and concatenate in manifest order,
 *   4. clamp the whole thing to the global token budget.
 *
 * The {@link KbDistiller} interface is the documented extension point for
 * the "big model reads the repo at build time" idea: an `LlmKbDistiller`
 * would implement the same contract but replace steps 1–2 with a
 * model-driven summarization pass, then reuse the same budget clamp. The
 * build script depends on the interface, not the implementation, so
 * swapping distillers is a one-line change with no downstream churn.
 *
 * Distillation is deterministic by construction — no clocks, no RNG, no
 * network. The same inputs always produce the same digest, which is what
 * lets the committed artifact be diff-reviewable and the loader cache be
 * trusted.
 *
 * @module domains/assistant/kb/distiller
 */

import { clampToTokenBudget, estimateTokens } from "./tokens";

/** Raw input document for distillation. */
export interface KbSourceDoc {
  /** Stable id (used in stats + provenance). */
  readonly id: string;
  /** Human-facing section title rendered into the digest. */
  readonly title: string;
  /** Full document text (already read from disk by the caller). */
  readonly text: string;
  /**
   * Optional per-source token cap. When omitted the source is bounded
   * only by the global budget.
   */
  readonly maxTokens?: number;
  /**
   * Optional list of markdown headings (exact text, without leading `#`s)
   * to extract from the source. When set, only those sections survive —
   * everything else in the doc is dropped before budgeting. When omitted
   * the whole document is used.
   */
  readonly headings?: ReadonlyArray<string>;
}

/** Per-source accounting in the produced digest. */
export interface KbSourceStat {
  readonly id: string;
  readonly title: string;
  readonly chars: number;
  readonly estimatedTokens: number;
  /** True if this source was clipped by its per-source cap or the global budget. */
  readonly truncated: boolean;
}

/** The distilled grounding digest. */
export interface KbDigest {
  /** The grounding text fed to the model as system context. */
  readonly text: string;
  readonly estimatedTokens: number;
  readonly budgetTokens: number;
  readonly sources: ReadonlyArray<KbSourceStat>;
  /** Provenance note (e.g. which builder + when), for the artifact header. */
  readonly generatedFrom: string;
}

export interface KbDistillOptions {
  readonly budgetTokens: number;
  /** Free-text provenance note copied into {@link KbDigest.generatedFrom}. */
  readonly generatedFrom?: string;
}

/**
 * Contract every distiller honours. Implementations MUST be deterministic
 * for a given input + options.
 */
export interface KbDistiller {
  distill(
    sources: ReadonlyArray<KbSourceDoc>,
    opts: KbDistillOptions,
  ): KbDigest;
}

const BLOCK_SEPARATOR = "\n\n---\n\n";

/**
 * Deterministic, dependency-free distiller (v1). See module doc for the
 * pipeline. No LLM calls — this is the baseline grounding everyone gets.
 */
export class DeterministicKbDistiller implements KbDistiller {
  distill(
    sources: ReadonlyArray<KbSourceDoc>,
    opts: KbDistillOptions,
  ): KbDigest {
    const budgetTokens = Math.max(0, Math.floor(opts.budgetTokens));
    const blocks: string[] = [];
    const stats: KbSourceStat[] = [];

    for (const src of sources) {
      // 1. section-extract (optional) → 2. per-source clip.
      const selected =
        src.headings && src.headings.length > 0
          ? extractSections(src.text, src.headings)
          : src.text;
      const normalized = selected.trim();
      if (normalized.length === 0) {
        stats.push({
          id: src.id,
          title: src.title,
          chars: 0,
          estimatedTokens: 0,
          truncated: src.text.trim().length > 0,
        });
        continue;
      }
      const capped =
        src.maxTokens !== undefined
          ? clampToTokenBudget(normalized, src.maxTokens)
          : { text: normalized, truncated: false };
      blocks.push(`## ${src.title}\n\n${capped.text}`);
      stats.push({
        id: src.id,
        title: src.title,
        chars: capped.text.length,
        estimatedTokens: estimateTokens(capped.text),
        truncated: capped.truncated,
      });
    }

    // 3. concatenate → 4. global budget clamp.
    const joined = blocks.join(BLOCK_SEPARATOR);
    const clamped = clampToTokenBudget(joined, budgetTokens);

    return {
      text: clamped.text,
      estimatedTokens: estimateTokens(clamped.text),
      budgetTokens,
      // If the global clamp trimmed the tail, the last source(s) lost
      // content beyond what their own stat recorded — flag globally.
      sources: clamped.truncated ? markTailTruncated(stats, clamped.text) : stats,
      generatedFrom: opts.generatedFrom ?? "DeterministicKbDistiller",
    };
  }
}

/**
 * Extract the named markdown sections from `markdown`, in document order.
 * A "section" is a heading line (`#`..`######`) whose trimmed text matches
 * one of `headings`, plus every line up to (but excluding) the next
 * heading at the same or shallower level. Unmatched headings are skipped
 * silently — a renamed doc heading degrades to less grounding, never a
 * crash.
 */
export function extractSections(
  markdown: string,
  headings: ReadonlyArray<string>,
): string {
  const wanted = new Set(headings.map((h) => h.trim().toLowerCase()));
  const lines = markdown.split("\n");
  const out: string[] = [];
  let capturing = false;
  let captureLevel = 0;

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1]!.length;
      const title = m[2]!.trim().toLowerCase();
      if (capturing && level <= captureLevel) {
        // A heading at the same or shallower level closes the section.
        capturing = false;
      }
      if (!capturing && wanted.has(title)) {
        capturing = true;
        captureLevel = level;
        out.push(line);
        continue;
      }
    }
    if (capturing) out.push(line);
  }

  return out.join("\n").trim();
}

/**
 * After a global-budget clip, mark sources whose content fell entirely
 * outside the surviving text as truncated, so the stats don't claim
 * content the digest no longer carries.
 */
function markTailTruncated(
  stats: ReadonlyArray<KbSourceStat>,
  survivingText: string,
): KbSourceStat[] {
  return stats.map((s) => {
    if (s.truncated || s.chars === 0) return { ...s };
    const present = survivingText.includes(`## ${s.title}`);
    return present ? { ...s } : { ...s, truncated: true };
  });
}
