/**
 * Model catalog service.
 *
 * Owns the picker shape, the at-most-one-default invariant, and the
 * resolve-model decision used by the playground / skill-gen execute
 * paths.
 *
 * @module domains/models/service
 */

import pino from "pino";
import type { NyxLlmCatalogClient } from "../../clients/nyxid/llmCatalog";
import type { Surface } from "../quota/types";
import type { ModelsRepository } from "./repository";
import {
  type ModelDocument,
  type ModelResolution,
  type PickerModel,
  type RefreshOutcome,
  defaultFieldFor,
  enabledFieldFor,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "modelsService" });

export interface ModelsServiceConfig {
  readonly repo: ModelsRepository;
  readonly catalogClient: NyxLlmCatalogClient;
}

export class ModelsService {
  private readonly repo: ModelsRepository;
  private readonly catalogClient: NyxLlmCatalogClient;

  constructor(config: ModelsServiceConfig) {
    this.repo = config.repo;
    this.catalogClient = config.catalogClient;
  }

  async refresh(now: Date = new Date()): Promise<RefreshOutcome> {
    const upstream = await this.catalogClient.listUpstreamModels();
    const result = await this.repo.sync(
      upstream.map((m) => ({ id: m.id, displayName: m.displayName })),
      now,
    );
    return { ...result, syncedAt: now.toISOString() };
  }

  async listAdminCatalog(includeArchived: boolean): Promise<ModelDocument[]> {
    return this.repo.listAll(includeArchived);
  }

  async listPickerModels(surface: Surface): Promise<{
    items: PickerModel[];
    default: string | null;
  }> {
    const enabled = await this.repo.listEnabledForSurface(surface);
    if (enabled.length === 0) {
      return { items: [], default: null };
    }
    const defaultField = defaultFieldFor(surface);
    const sorted = [...enabled].sort((a, b) => {
      const aIsDefault = a[defaultField] === true;
      const bIsDefault = b[defaultField] === true;
      if (aIsDefault !== bIsDefault) return aIsDefault ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    const items: PickerModel[] = sorted.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      isDefault: m[defaultField] === true,
    }));
    const defaultRow = items.find((i) => i.isDefault);
    return { items, default: defaultRow?.modelId ?? items[0]?.modelId ?? null };
  }

  /**
   * Resolve a request's chosen model. Behavior:
   *   - `requested` provided AND enabled+non-archived for surface ⇒ allow.
   *   - `requested` provided but not enabled for surface ⇒ `not-enabled`.
   *   - `requested` provided but no document exists ⇒ `not-found`.
   *   - `requested` undefined ⇒ surface default; if no default, the
   *     first enabled row; if none, `no-models-enabled`.
   */
  async resolveModel(params: {
    surface: Surface;
    requested?: string;
  }): Promise<ModelResolution> {
    const surface = params.surface;
    const enabledRows = await this.repo.listEnabledForSurface(surface);

    if (params.requested) {
      const stored = await this.repo.findById(params.requested);
      if (!stored || stored.archived) {
        return { kind: "not-found", surface, modelId: params.requested };
      }
      const enabledField = enabledFieldFor(surface);
      const isEnabled = stored[enabledField] === true;
      if (!isEnabled) {
        return { kind: "not-enabled", surface, modelId: params.requested };
      }
      return {
        kind: "ok",
        modelId: stored.modelId,
        displayName: stored.displayName,
      };
    }

    if (enabledRows.length === 0) {
      return { kind: "no-models-enabled", surface };
    }
    const defaultField = defaultFieldFor(surface);
    const def = enabledRows.find((r) => r[defaultField] === true);
    const winner = def ?? enabledRows[0];
    return { kind: "ok", modelId: winner.modelId, displayName: winner.displayName };
  }

  async patchFlags(
    modelId: string,
    updates: Parameters<ModelsRepository["patchFlags"]>[1],
  ): Promise<ModelDocument | null> {
    const updated = await this.repo.patchFlags(modelId, updates);
    if (updated) {
      logger.info({ modelId, updates }, "Model flags patched");
    }
    return updated;
  }
}
