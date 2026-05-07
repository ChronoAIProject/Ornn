/**
 * One-time boot migration for #270 — fold the standalone `models`
 * collection into per-provider `llm_providers.models[]` arrays.
 *
 * What it does, in order:
 *
 *   1. Walks every doc in the legacy `models` collection. For each, finds
 *      every provider whose `models[]` carries an entry with the same
 *      `id` and copies the four surface flags
 *      (`enabledForPlayground`, `enabledForSkillGen`,
 *      `defaultForPlayground`, `defaultForSkillGen`) onto that entry.
 *   2. Walks every provider's `models[]` and fills in default `false`
 *      flags for any entry that's missing them (covers
 *      provider-models that never had a row in the legacy catalog).
 *   3. Drops the legacy `models` collection iff at least one of (1) /
 *      (2) actually copied data — otherwise leaves it intact for a
 *      manual investigation.
 *
 * Idempotent: rerun safely. Detects "already migrated" by the absence
 * of the legacy collection, and short-circuits.
 *
 * @module domains/settings/llmProviders/migration
 */

import type { Db, Document } from "mongodb";
import pino from "pino";

const logger = pino({ level: "info" }).child({
  module: "llmProvidersMigration",
});

interface LegacyModelRow {
  modelId: string;
  enabledForPlayground?: boolean;
  enabledForSkillGen?: boolean;
  defaultForPlayground?: boolean;
  defaultForSkillGen?: boolean;
}

interface ProviderModelRaw {
  id: string;
  enabledForPlayground?: boolean;
  enabledForSkillGen?: boolean;
  defaultForPlayground?: boolean;
  defaultForSkillGen?: boolean;
  // … other fields preserved verbatim
  [k: string]: unknown;
}

interface ProviderRaw extends Document {
  _id: string;
  name?: string;
  models?: ProviderModelRaw[];
}

export interface MigrationResult {
  legacyRowsConsidered: number;
  flagsCopied: number;
  modelsBackfilled: number;
  legacyCollectionDropped: boolean;
}

/**
 * Run the migration. Safe to call on every boot — see module doc.
 */
export async function migrateModelCatalogIntoProviders(
  db: Db,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    legacyRowsConsidered: 0,
    flagsCopied: 0,
    modelsBackfilled: 0,
    legacyCollectionDropped: false,
  };

  // Detect the legacy collection without erroring on a fresh DB. Mongo's
  // `listCollections` is the cheap, side-effect-free probe.
  const legacyExists = await db
    .listCollections({ name: "models" })
    .hasNext()
    .catch(() => false);

  const providers = db.collection<ProviderRaw>("llm_providers");

  if (legacyExists) {
    const legacyRows = (await db
      .collection("models")
      .find({})
      .toArray()) as unknown as LegacyModelRow[];
    result.legacyRowsConsidered = legacyRows.length;

    for (const row of legacyRows) {
      // Fold any non-`false` flag onto matching provider models. We only
      // overwrite the per-provider flags if the legacy row actually
      // carries `true` — preserve any already-set value otherwise.
      const updates: Partial<Record<keyof LegacyModelRow, boolean>> = {};
      if (row.enabledForPlayground === true) updates.enabledForPlayground = true;
      if (row.enabledForSkillGen === true) updates.enabledForSkillGen = true;
      if (row.defaultForPlayground === true) updates.defaultForPlayground = true;
      if (row.defaultForSkillGen === true) updates.defaultForSkillGen = true;
      if (Object.keys(updates).length === 0) continue;

      // For each provider that knows this modelId, set the flag.
      const matching = await providers
        .find({ "models.id": row.modelId })
        .toArray();
      for (const provider of matching) {
        const setOps: Document = {};
        for (const [k, v] of Object.entries(updates)) {
          setOps[`models.$[m].${k}`] = v;
        }
        await providers.updateOne(
          { _id: provider._id },
          { $set: setOps },
          { arrayFilters: [{ "m.id": row.modelId }] },
        );
        result.flagsCopied += Object.keys(updates).length;
      }
    }
  }

  // Backfill default-`false` flags on any provider model still missing them
  // (e.g. provider rows that never had a legacy row to fold from).
  const allProviders = await providers.find({}).toArray();
  for (const provider of allProviders) {
    if (!Array.isArray(provider.models) || provider.models.length === 0) continue;
    let dirty = false;
    const nextModels = provider.models.map((m) => {
      const next = { ...m } as ProviderModelRaw;
      let touched = false;
      for (const k of [
        "enabledForPlayground",
        "enabledForSkillGen",
        "defaultForPlayground",
        "defaultForSkillGen",
      ] as const) {
        if (typeof next[k] !== "boolean") {
          // Map legacy `enabled` boolean → enabledForX (preserve operator
          // intent — anything they had toggled on stays toggled on).
          if (
            (k === "enabledForPlayground" || k === "enabledForSkillGen") &&
            (next as { enabled?: boolean }).enabled === true
          ) {
            next[k] = true;
          } else {
            next[k] = false;
          }
          touched = true;
        }
      }
      // Drop the legacy `enabled` field — confusing to leave it alongside
      // the new per-surface flags.
      if ("enabled" in next) {
        delete (next as { enabled?: boolean }).enabled;
        touched = true;
      }
      if (touched) {
        dirty = true;
        result.modelsBackfilled += 1;
      }
      return next;
    });
    if (dirty) {
      await providers.updateOne(
        { _id: provider._id },
        { $set: { models: nextModels } },
      );
    }
  }

  // Drop the legacy collection if we touched anything OR if it exists but
  // is empty (clean handoff). Bail out only if it exists AND has rows AND
  // we copied nothing — that's the "something's weird, leave it for an
  // operator" case.
  if (legacyExists) {
    const safeToDrop =
      result.flagsCopied > 0 || result.legacyRowsConsidered === 0;
    if (safeToDrop) {
      await db.collection("models").drop().catch((err) => {
        logger.warn({ err: (err as Error).message }, "Legacy `models` collection drop failed (already gone?)");
      });
      result.legacyCollectionDropped = true;
    } else {
      logger.warn(
        { ...result },
        "Legacy `models` collection has rows but no flags were copied — leaving it intact for manual review",
      );
    }
  }

  if (
    result.legacyRowsConsidered > 0 ||
    result.flagsCopied > 0 ||
    result.modelsBackfilled > 0 ||
    result.legacyCollectionDropped
  ) {
    logger.info(
      { ...result },
      "Per-provider model catalog migration complete (#270)",
    );
  }
  return result;
}
