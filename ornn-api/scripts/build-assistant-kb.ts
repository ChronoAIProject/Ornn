/**
 * Build the Ornn Assistant knowledge-base digest (#970).
 *
 *   bun run scripts/build-assistant-kb.ts
 *
 * Reads the curated repo docs declared in
 * `src/domains/assistant/kb/sources.ts`, distills them into a single
 * size-budgeted grounding digest, and writes the committed artifact at
 * `src/domains/assistant/kb/digest.generated.md`. The runtime loader reads
 * that artifact — it never re-reads these source docs.
 *
 * v1 uses the deterministic distiller (priority-ordered curation + per-
 * source caps + global budget clamp). The "big model reads the repo at
 * build time" idea slots in here: swap `DeterministicKbDistiller` for an
 * `LlmKbDistiller` that implements the same `KbDistiller` contract — the
 * rest of this script (sourcing, writing, provenance) is unchanged.
 *
 * Budget is overridable via the `ASSISTANT_KB_TOKEN_BUDGET` env var.
 *
 * Determinism note: the artifact header intentionally carries NO timestamp
 * so re-running on unchanged inputs yields a byte-identical file (clean
 * diffs, stable CI). Provenance is the input list + budget, not a clock.
 *
 * @module scripts/build-assistant-kb
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../src/shared/logger";
import {
  DeterministicKbDistiller,
  type KbDistiller,
  type KbSourceDoc,
} from "../src/domains/assistant/kb/distiller";
import { KB_SOURCE_MANIFEST } from "../src/domains/assistant/kb/sources";
import { DIGEST_ARTIFACT_FILENAME } from "../src/domains/assistant/kb/loader";
import { resolveKbTokenBudget } from "../src/domains/assistant/kb/tokens";

const logger = createLogger("buildAssistantKb");

// scripts/ → ornn-api/ → repo root
const REPO_ROOT = join(import.meta.dir, "..", "..");
const ARTIFACT_PATH = join(
  import.meta.dir,
  "..",
  "src",
  "domains",
  "assistant",
  "kb",
  DIGEST_ARTIFACT_FILENAME,
);

/**
 * Read each manifest source from the repo root. Missing files are skipped
 * with a warning — a doc rename must not break the build, it just yields
 * less grounding until the manifest is retuned.
 */
function readSources(): KbSourceDoc[] {
  const docs: KbSourceDoc[] = [];
  for (const spec of KB_SOURCE_MANIFEST) {
    const abs = join(REPO_ROOT, spec.repoRelPath);
    let text: string;
    try {
      text = readFileSync(abs, "utf-8");
    } catch (err) {
      logger.warn(
        { id: spec.id, path: spec.repoRelPath, err: (err as Error).message },
        "KB source missing — skipping",
      );
      continue;
    }
    docs.push({
      id: spec.id,
      title: spec.title,
      text,
      maxTokens: spec.maxTokens,
      ...(spec.headings ? { headings: spec.headings } : {}),
    });
  }
  return docs;
}

function renderArtifact(
  digestText: string,
  header: {
    budgetTokens: number;
    estimatedTokens: number;
    sources: ReadonlyArray<{ id: string; estimatedTokens: number; truncated: boolean }>;
  },
): string {
  const sourceLines = header.sources
    .map(
      (s) =>
        `  - ${s.id}: ~${s.estimatedTokens} tok${s.truncated ? " (clipped)" : ""}`,
    )
    .join("\n");
  // HTML-comment provenance block — stripped by the loader, never fed to
  // the model. No timestamp (see module doc: deterministic output).
  const meta = [
    "<!--",
    "  GENERATED FILE — do not edit by hand.",
    "  Produced by ornn-api/scripts/build-assistant-kb.ts (#970).",
    "  Re-run: `bun run scripts/build-assistant-kb.ts` from ornn-api/.",
    `  budgetTokens: ${header.budgetTokens}`,
    `  estimatedTokens: ${header.estimatedTokens}`,
    "  sources:",
    sourceLines,
    "-->",
    "",
  ].join("\n");
  return `${meta}\n${digestText}\n`;
}

function main(): void {
  const budgetTokens = resolveKbTokenBudget();
  const distiller: KbDistiller = new DeterministicKbDistiller();

  const sources = readSources();
  if (sources.length === 0) {
    logger.error("No KB sources could be read — aborting without writing artifact");
    process.exitCode = 1;
    return;
  }

  const digest = distiller.distill(sources, {
    budgetTokens,
    generatedFrom: "scripts/build-assistant-kb.ts (DeterministicKbDistiller)",
  });

  const artifact = renderArtifact(digest.text, {
    budgetTokens: digest.budgetTokens,
    estimatedTokens: digest.estimatedTokens,
    sources: digest.sources,
  });

  writeFileSync(ARTIFACT_PATH, artifact, "utf-8");

  logger.info(
    {
      artifact: ARTIFACT_PATH,
      budgetTokens: digest.budgetTokens,
      estimatedTokens: digest.estimatedTokens,
      sourceCount: digest.sources.length,
      sources: digest.sources.map((s) => ({
        id: s.id,
        tokens: s.estimatedTokens,
        truncated: s.truncated,
      })),
    },
    "Assistant KB digest written",
  );
}

main();
