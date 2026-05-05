/**
 * Admin-curated LLM catalog. Sync-on-demand — admin clicks "Refresh
 * catalog", backend pulls Chrono LLM via the NyxID proxy and upserts
 * into a local `models` collection. New models default disabled.
 *
 * Per #251: v1 ships flat-priced. We surface raw `modelId` in pickers;
 * rich metadata (cost tier, capability, recommended-use blurb) is
 * phase-2.
 *
 * @module domains/models/types
 */

import type { Surface } from "../quota/types";

export interface ModelDocument {
  /** Upstream Chrono LLM `id`, e.g. `gpt-5-mini`. Primary key. */
  modelId: string;
  /** Upstream `display_name`, copied at sync time. Falls back to `modelId`. */
  displayName: string;
  /** Admin toggle — when false the picker hides this model. */
  enabledForPlayground: boolean;
  /** Admin toggle — when false skill-gen rejects requests with this id. */
  enabledForSkillGen: boolean;
  /**
   * At-most-one-true per surface, enforced server-side: when one model
   * is set as default, any prior default is cleared in the same update.
   */
  defaultForPlayground: boolean;
  defaultForSkillGen: boolean;
  /**
   * Set true when the model is no longer present in the latest upstream
   * sync. Archived rows are preserved for audit / history but are
   * filtered out of pickers and execute validation.
   */
  archived: boolean;
  /** Last successful sync timestamp. */
  lastSyncedAt: Date;
  /** Insert time (preserved across refreshes). */
  createdAt: Date;
}

/**
 * Snapshot returned by the user-facing picker (`GET /me/models`).
 * Default sorts first; remaining models sorted by `displayName`.
 */
export interface PickerModel {
  modelId: string;
  displayName: string;
  isDefault: boolean;
}

export interface RefreshOutcome {
  added: number;
  updated: number;
  archived: number;
  total: number;
  syncedAt: string;
}

/**
 * Resolution outcome from `resolveModel`. The execute path uses this to
 * decide whether to proceed or 503/4xx.
 */
export type ModelResolution =
  | { kind: "ok"; modelId: string; displayName: string }
  | { kind: "no-models-enabled"; surface: Surface }
  | { kind: "not-enabled"; surface: Surface; modelId: string }
  | { kind: "not-found"; surface: Surface; modelId: string };

export const MODEL_ADMIN_PERMISSION = "ornn:admin:skill" as const;

export function enabledFieldFor(surface: Surface): keyof ModelDocument {
  return surface === "playground" ? "enabledForPlayground" : "enabledForSkillGen";
}

export function defaultFieldFor(surface: Surface): keyof ModelDocument {
  return surface === "playground" ? "defaultForPlayground" : "defaultForSkillGen";
}
