/**
 * Settings exporter (Story 8.1).
 *
 * Builds a `{ schemaVersion, exportedAt, ornnVersion, sections: { ... } }`
 * envelope. Every secret field is replaced with a redaction sentinel
 * (`<REDACTED:fieldName>`) so the file never carries plaintext or
 * provider-bound ciphertext.
 *
 * The exporter is pure: it reads through the public SettingsService API,
 * which already decrypts on read. We strip secrets back out before
 * serializing.
 *
 * @module domains/settings/exportImport/exporter
 */

import { redactSentinel } from "../../../infra/crypto";
import {
  PROVIDER_SECRET_FIELDS,
  type LlmProvider,
} from "../llmProviders/types";
import { sections, type SectionId } from "../sections";
import type { SettingsService } from "../types";

export const SETTINGS_SCHEMA_VERSION = 1;

export interface ExportEnvelope {
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly ornnVersion: string | null;
  readonly sections: Record<string, unknown>;
}

export interface ExporterDeps {
  readonly settingsService: SettingsService;
  readonly ornnVersion?: string;
  readonly clock?: () => Date;
}

export class SettingsExporter {
  private readonly settingsService: SettingsService;
  private readonly ornnVersion: string | null;
  private readonly clock: () => Date;

  constructor(deps: ExporterDeps) {
    this.settingsService = deps.settingsService;
    this.ornnVersion = deps.ornnVersion ?? null;
    this.clock = deps.clock ?? (() => new Date());
  }

  async export(): Promise<ExportEnvelope> {
    const out: Record<string, unknown> = {};
    for (const id of Object.keys(sections) as SectionId[]) {
      const meta = sections[id];
      const value = await this.settingsService.getSection<Record<string, unknown>>(id);
      out[id] = redactSecretFields(value, meta.secretFields);
    }
    const providers = await this.settingsService.listLlmProviders();
    out.llmProviders = providers.map((p) => redactProviderSecrets(p));
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      exportedAt: this.clock().toISOString(),
      ornnVersion: this.ornnVersion,
      sections: out,
    };
  }

  /** Deterministic filename for `Content-Disposition: attachment`. */
  filenameFor(envName: string): string {
    const ts = this.clock().toISOString().replace(/[:.]/g, "-");
    return `ornn-settings-${envName}-${ts}.json`;
  }
}

function redactSecretFields(
  value: Record<string, unknown>,
  secretFields: ReadonlyArray<string>,
): Record<string, unknown> {
  if (secretFields.length === 0) return value;
  const out: Record<string, unknown> = { ...value };
  for (const field of secretFields) {
    if (typeof out[field] === "string" && (out[field] as string).length > 0) {
      out[field] = redactSentinel(field);
    }
  }
  return out;
}

function redactProviderSecrets(p: LlmProvider): Record<string, unknown> {
  const auth: Record<string, unknown> = { ...p.auth };
  const fields = PROVIDER_SECRET_FIELDS[p.auth.kind] as ReadonlyArray<string>;
  for (const field of fields) {
    if (typeof auth[field] === "string" && (auth[field] as string).length > 0) {
      auth[field] = redactSentinel(field);
    }
  }
  // Trim each model entry to operator-set state only. The synced
  // catalog fields (displayName, firstSeenAt, lastSyncedAt) are
  // derived data — refilled by the next /sync against the upstream
  // gateway — and don't belong in a portable export. The flags
  // (enabledFor*, defaultFor*, removed) ARE operator state and stay.
  // See #330.
  const models = p.models.map((m) => ({
    id: m.id,
    enabledForPlayground: m.enabledForPlayground,
    enabledForSkillGen: m.enabledForSkillGen,
    defaultForPlayground: m.defaultForPlayground,
    defaultForSkillGen: m.defaultForSkillGen,
    removed: m.removed,
  }));
  return {
    _id: p._id,
    name: p.name,
    gatewayUrl: p.gatewayUrl,
    modelListUrl: p.modelListUrl,
    apiFormat: p.apiFormat,
    auth,
    models,
    maxOutputTokens: p.maxOutputTokens,
    defaultTemperature: p.defaultTemperature,
  };
}
