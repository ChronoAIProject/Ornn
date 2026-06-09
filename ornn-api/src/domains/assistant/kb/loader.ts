/**
 * Runtime loader for the Ornn Assistant knowledge base (#970).
 *
 * The KB digest is a *committed build artifact* (`digest.generated.md`)
 * produced by `scripts/build-assistant-kb.ts`. The loader's only job is to
 * read that single file, strip its provenance header, defensively clamp it
 * to the token budget, and cache the result in-process. It deliberately
 * does NOT re-read the repo's source docs at runtime — those don't ship in
 * the container, and re-distilling on every boot would be non-deterministic
 * and slow. Build-time produces; runtime consumes.
 *
 * Deterministic + cached: the first `load()` reads + parses the artifact;
 * every subsequent call returns the cached value. A failed read degrades to
 * empty grounding (logged) rather than crashing the assistant — the skill
 * retrieval + the user's question still produce a useful answer.
 *
 * @module domains/assistant/kb/loader
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createLogger } from "../../../shared/logger";
import {
  clampToTokenBudget,
  estimateTokens,
  resolveKbTokenBudget,
} from "./tokens";

const logger = createLogger("assistantKb");

/** Loaded grounding, ready to drop into the LLM system context. */
export interface AssistantKb {
  /** Grounding text (provenance header stripped, budget-clamped). */
  readonly text: string;
  readonly estimatedTokens: number;
  readonly budgetTokens: number;
  /** True if the artifact exceeded the budget and was clamped on load. */
  readonly truncated: boolean;
}

/** Filename of the committed digest artifact, colocated with this module. */
export const DIGEST_ARTIFACT_FILENAME = "digest.generated.md";

/** Default reader — reads the colocated committed artifact. */
export function defaultDigestReader(): string {
  return readFileSync(join(import.meta.dir, DIGEST_ARTIFACT_FILENAME), "utf-8");
}

export interface AssistantKbLoaderDeps {
  /** Token budget; defaults to the env-resolved value. */
  readonly budgetTokens?: number;
  /** Digest source; injectable for tests. Defaults to the artifact file. */
  readonly readDigest?: () => string;
}

/**
 * Reads + caches the assistant KB digest. One instance per process is the
 * intended usage (constructed in bootstrap); the cache lives for the
 * process lifetime since the artifact is immutable at runtime.
 */
export class AssistantKbLoader {
  private readonly budgetTokens: number;
  private readonly readDigest: () => string;
  private cached: AssistantKb | null = null;

  constructor(deps: AssistantKbLoaderDeps = {}) {
    this.budgetTokens = deps.budgetTokens ?? resolveKbTokenBudget();
    this.readDigest = deps.readDigest ?? defaultDigestReader;
  }

  load(): AssistantKb {
    if (this.cached) return this.cached;

    let raw = "";
    try {
      raw = this.readDigest();
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "assistant KB digest read failed — grounding degrades to empty",
      );
    }

    const body = stripMetadataBlock(raw).trim();
    const { text, truncated } = clampToTokenBudget(body, this.budgetTokens);
    if (truncated) {
      logger.warn(
        { budgetTokens: this.budgetTokens },
        "assistant KB digest exceeded token budget on load — clamped defensively",
      );
    }

    const kb: AssistantKb = {
      text,
      estimatedTokens: estimateTokens(text),
      budgetTokens: this.budgetTokens,
      truncated,
    };
    this.cached = kb;
    logger.info(
      {
        estimatedTokens: kb.estimatedTokens,
        budgetTokens: kb.budgetTokens,
        truncated,
      },
      "assistant KB digest loaded",
    );
    return kb;
  }

  /** Ops/test hook: drop the cache so the next `load()` re-reads. */
  invalidate(): void {
    this.cached = null;
  }
}

/**
 * Strip a single leading HTML comment block — the generated-artifact
 * provenance header — so build metadata never reaches the model context.
 * A BOM, if present, is tolerated before the comment.
 */
export function stripMetadataBlock(raw: string): string {
  return raw.replace(/^\uFEFF?\s*<!--[\s\S]*?-->\s*/, "");
}
