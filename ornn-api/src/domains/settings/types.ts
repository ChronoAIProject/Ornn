/**
 * SettingsService public interface. Other domains import THIS file (not
 * the implementation) so the type surface is the only coupling — each
 * subsystem gets its own typed accessor and never reaches into per-
 * section internals.
 *
 * Stable contract: methods, names, and shapes are agreed across the
 * three backend engineers. Adding a new section means adding a new
 * `getXxx()` here + a section schema under `sections/`; no other
 * caller in the codebase needs to change.
 *
 * @module domains/settings/types
 */

import type {
  ExtrasSection,
  MirrorSection,
  NyxidSection,
  PlaygroundSection,
  QuotaDefaultsSection,
  SectionId,
  ServicesSection,
  SkillAuditSection,
  SkillGenSection,
  TelemetrySection,
} from "./sections";
import type { LlmProvider } from "./llmProviders/types";

export interface SettingsActor {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
}

/**
 * Result envelope for `putSection`. Callers can introspect which fields
 * actually changed so the audit trail captures meaningful diffs without
 * leaking secret values.
 */
export interface PutSectionResult<T> {
  readonly value: T;
  readonly changedFields: ReadonlyArray<string>;
}

/**
 * The full SettingsService API. Implementations MUST decrypt secrets at
 * the service boundary (callers see plaintext, except where explicitly
 * mid-masked) and bust their cache on every successful `putSection`.
 */
export interface SettingsService {
  // ---- Per-section typed accessors ----
  getPlayground(): Promise<PlaygroundSection>;
  getSkillGen(): Promise<SkillGenSection>;
  getMirror(): Promise<MirrorSection>;
  getNyxid(): Promise<NyxidSection>;
  getServices(): Promise<ServicesSection>;
  getSkillAudit(): Promise<SkillAuditSection>;
  getTelemetry(): Promise<TelemetrySection>;
  getQuotaDefaults(): Promise<QuotaDefaultsSection>;
  getExtras(): Promise<ExtrasSection>;

  /**
   * Read a section by id. Returns the typed payload, applying defaults
   * for any field the admin hasn't set. Secrets are returned in
   * plaintext for internal callers; HTTP routes mid-mask them.
   */
  getSection<T>(id: SectionId): Promise<T>;

  /**
   * Replace a section. Validates input through the section's Zod
   * schema, encrypts secret fields, persists, and returns the post-
   * write value (plaintext, internal). Audit-log emission is the
   * caller's job.
   */
  putSection<T>(
    id: SectionId,
    value: T,
    actor: SettingsActor,
  ): Promise<PutSectionResult<T>>;

  // ---- LLM providers (one doc per provider) ----
  listLlmProviders(): Promise<ReadonlyArray<LlmProvider>>;
  getLlmProvider(id: string): Promise<LlmProvider | null>;

  /** Bust the in-memory cache (used by tests + the admin import flow). */
  invalidateCache(): void;
}
