/**
 * Settings importer (Story 8.2).
 *
 * Validates `{ schemaVersion, sections }` envelope, runs each section's
 * Zod schema, and applies one section at a time. Per-section atomicity
 * comes from the underlying single-document write; cross-section partial
 * apply is allowed and reported in the response.
 *
 * Sentinel detection inherits the SettingsService's behavior: secret
 * fields with the redaction sentinel (or the mid-mask sentinel) are
 * preserved as the existing DB value; real strings overwrite.
 *
 * @module domains/settings/exportImport/importer
 */

import { createLogger } from "../../../shared/logger";
import { sections, type SectionId } from "../sections";
import type { SettingsActor, SettingsService } from "../types";
import { SETTINGS_SCHEMA_VERSION } from "./exporter";

const logger = createLogger("settingsImporter");

export interface ImportInput {
  readonly schemaVersion?: unknown;
  readonly sections?: unknown;
}

export type SectionStatus = "applied" | "skipped" | "failed";

export interface SectionImportResult {
  readonly id: SectionId | "llmProviders";
  readonly status: SectionStatus;
  readonly changedFields?: ReadonlyArray<string>;
  readonly errors?: ReadonlyArray<{ field: string; message: string }>;
}

export interface ImportResult {
  readonly schemaVersion: number;
  readonly aggregateStatus: "applied" | "partial" | "failed";
  readonly sections: ReadonlyArray<SectionImportResult>;
}

export interface ImporterDeps {
  readonly settingsService: SettingsService;
}

export class SettingsImporter {
  private readonly settingsService: SettingsService;

  constructor(deps: ImporterDeps) {
    this.settingsService = deps.settingsService;
  }

  async import(
    input: ImportInput,
    actor: SettingsActor,
    opts: { dryRun?: boolean } = {},
  ): Promise<ImportResult> {
    const dryRun = opts.dryRun ?? false;

    if (input.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
      // Hard fail: schema mismatch → no writes at all.
      return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        aggregateStatus: "failed",
        sections: [
          {
            id: "extras",
            status: "failed",
            errors: [
              {
                field: "schemaVersion",
                message: `expected ${SETTINGS_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`,
              },
            ],
          },
        ],
      };
    }

    const incoming = (input.sections ?? {}) as Record<string, unknown>;
    const results: SectionImportResult[] = [];

    for (const id of Object.keys(sections) as SectionId[]) {
      const meta = sections[id];
      const candidate = incoming[id];
      if (candidate === undefined) {
        results.push({ id, status: "skipped" });
        continue;
      }
      // Dry-run: just validate.
      const parsed = meta.schema.safeParse(candidate);
      if (!parsed.success) {
        results.push({
          id,
          status: "failed",
          errors: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
        continue;
      }
      if (dryRun) {
        results.push({ id, status: "applied", changedFields: [] });
        continue;
      }
      try {
        const r = await this.settingsService.putSection<Record<string, unknown>>(
          id,
          parsed.data as Record<string, unknown>,
          actor,
        );
        results.push({
          id,
          status: "applied",
          changedFields: r.changedFields,
        });
      } catch (err) {
        logger.error(
          { sectionId: id, err: (err as Error).message },
          "Section import failed",
        );
        results.push({
          id,
          status: "failed",
          errors: [{ field: "", message: (err as Error).message }],
        });
      }
    }

    // LLM providers are reported as a single composite section in v1 —
    // the actual write path goes through the LlmProvidersService and
    // is out of scope for the importer's transactional path. We skip
    // unless caller explicitly opts in via an opt-in flag (future).
    if (incoming.llmProviders !== undefined) {
      results.push({
        id: "llmProviders",
        status: "skipped",
        errors: [
          {
            field: "llmProviders",
            message:
              "LLM providers are not imported in v1; manage via /admin/settings/llm-providers",
          },
        ],
      });
    }

    const failedCount = results.filter((r) => r.status === "failed").length;
    const appliedCount = results.filter((r) => r.status === "applied").length;
    const aggregateStatus: ImportResult["aggregateStatus"] =
      failedCount === 0
        ? appliedCount > 0
          ? "applied"
          : "applied"
        : appliedCount === 0
        ? "failed"
        : "partial";

    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      aggregateStatus,
      sections: results,
    };
  }
}
