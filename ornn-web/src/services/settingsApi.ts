/**
 * Admin settings API — per-section read/write + export/import + LLM
 * provider CRUD.
 *
 * Section endpoints follow the contract:
 *   GET /api/v1/admin/settings/<section> → { data: SectionDoc, error: null }
 *   PUT /api/v1/admin/settings/<section> → { data: SectionDoc, error: null }
 *
 * Secrets in GET responses are mid-masked. PUT accepts:
 *   - the same mid-mask sentinel ⇒ keep DB value (UI passes the response back)
 *   - the redaction sentinel `<REDACTED:fieldName>` ⇒ keep DB value
 *   - any other string ⇒ encrypt + write
 *
 * Export/import operates on the same shape with `<REDACTED:fieldName>`
 * sentinels in place of secret values.
 *
 * @module services/settingsApi
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./apiClient";

// --------------------------------------------------------------------- shared

export type SectionKey =
  | "playground"
  | "skill-generation"
  | "mirror"
  | "integrations/nyxid"
  | "integrations/services"
  | "skill-audit"
  | "telemetry"
  | "quota"
  | "extras";

export interface SectionMeta {
  updatedAt?: string;
  updatedBy?: string;
}

export const REDACTION_PREFIX = "<REDACTED:";

export function isRedactionSentinel(v: string): boolean {
  return v.startsWith(REDACTION_PREFIX) && v.endsWith(">");
}

/**
 * The mid-mask format the API uses for secret fields in GET responses.
 * Looks like `sk-ab••••••••••cd` — exact prefix/suffix length varies by
 * input. We can't write a regex more specific than "contains a bullet"
 * without coupling to the API; "any value with a `•` is mid-mask" is
 * the agreed contract.
 */
export function isMidMaskSentinel(v: string): boolean {
  return v.includes("•") || v.includes("•");
}

/** Decide whether a secret-shaped string should be sent on PUT or kept as DB. */
export function isSecretPreserveValue(v: string): boolean {
  return isRedactionSentinel(v) || isMidMaskSentinel(v);
}

// --------------------------------------------------------------------- sections

export interface PlaygroundSection extends SectionMeta {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  sseKeepAliveMs: number;
}

export interface SkillGenSection extends SectionMeta {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  sseKeepAliveMs: number;
}

export interface MirrorSection extends SectionMeta {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  appId: string;
  installationId: string;
  /** Mid-masked on GET; sentinel-or-plaintext on PUT. */
  appPrivateKey: string;
}

export interface NyxIdSection extends SectionMeta {
  tokenUrl: string;
  clientId: string;
  /** Mid-masked on GET. */
  clientSecret: string;
  /** API host the backend proxies through. Browser-side link coords
   * (frontend URL + my-services / my-profile / my-organization paths)
   * live in `ornn-web`'s configmap, not here — see #275. */
  baseApiUrl: string;
}

export interface ServicesSection extends SectionMeta {
  chronoStorageUrl: string;
  chronoStorageBucket: string;
  chronoSandboxUrl: string;
}

export interface SkillAuditSection extends SectionMeta {
  llmAuditEnabled: boolean;
  llmAuditDefaultProviderId: string | null;
  llmAuditDefaultModelId: string | null;
  riskThreshold: number;
  agentSealEnabled: boolean;
  agentSealTimeoutMs: number;
}

export interface TelemetrySection extends SectionMeta {
  openTelemetryEnabled: boolean;
  openTelemetryEndpoint: string;
  postHogEnabled: boolean;
  /** Mid-masked on GET. */
  postHogApiKey: string;
  postHogHost: string;
}

export interface QuotaDefaultsSection extends SectionMeta {
  defaultPlaygroundMonthly: number;
  defaultSkillGenMonthly: number;
}

export interface ExtrasSection extends SectionMeta {
  extraNyxidServices: Array<{
    name: string;
    baseUrl: string;
    scopes?: string[];
  }>;
}

export type SectionPayload =
  | PlaygroundSection
  | SkillGenSection
  | MirrorSection
  | NyxIdSection
  | ServicesSection
  | SkillAuditSection
  | TelemetrySection
  | QuotaDefaultsSection
  | ExtrasSection;

// --------------------------------------------------------------------- IO helpers

export async function fetchSection<T extends SectionPayload>(
  key: SectionKey,
): Promise<T> {
  const res = await apiGet<T>(`/api/v1/admin/settings/${key}`);
  if (!res.data) {
    throw new Error(`Section ${key} missing from response`);
  }
  return res.data;
}

export async function putSection<T extends SectionPayload>(
  key: SectionKey,
  body: T,
): Promise<T> {
  const res = await apiPut<T>(`/api/v1/admin/settings/${key}`, body);
  if (!res.data) {
    throw new Error(`Section ${key} put returned no data`);
  }
  return res.data;
}

// --------------------------------------------------------------------- LLM providers

export type LlmProviderApiFormat = "chat-completion" | "responses";

export type LlmProviderAuth =
  | { kind: "apiKey"; apiKey: string }
  | { kind: "tokenUrl"; tokenUrl: string; clientId: string; clientSecret: string }
  | { kind: "basic"; username: string; password: string };

export interface LlmProviderModel {
  id: string;
  displayName: string;
  /** Per-surface enable + default flags (#270). Resolver reads
   * `enabledFor<Surface>` and surfaces honour the at-most-one
   * `defaultFor<Surface>` invariant across every provider. */
  enabledForPlayground: boolean;
  enabledForSkillGen: boolean;
  defaultForPlayground: boolean;
  defaultForSkillGen: boolean;
  removed: boolean;
  firstSeenAt?: string;
  lastSyncedAt?: string;
}

export interface LlmProvider {
  _id: string;
  name: string;
  gatewayUrl: string;
  modelListUrl: string;
  apiFormat: LlmProviderApiFormat;
  auth: LlmProviderAuth;
  models: LlmProviderModel[];
  maxOutputTokens: number;
  defaultTemperature: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LlmProviderInput {
  name: string;
  gatewayUrl: string;
  modelListUrl: string;
  apiFormat: LlmProviderApiFormat;
  auth: LlmProviderAuth;
  maxOutputTokens: number;
  defaultTemperature: number;
}

/** Patch one model's surface flags. Anything absent is preserved. */
export interface ModelFlagsPatchInput {
  enabledForPlayground?: boolean;
  enabledForSkillGen?: boolean;
  defaultForPlayground?: boolean;
  defaultForSkillGen?: boolean;
}

export async function listLlmProviders(): Promise<LlmProvider[]> {
  const res = await apiGet<{ items: LlmProvider[] }>(
    "/api/v1/admin/settings/llm-providers",
  );
  return res.data?.items ?? [];
}

export async function getLlmProvider(id: string): Promise<LlmProvider> {
  const res = await apiGet<LlmProvider>(
    `/api/v1/admin/settings/llm-providers/${encodeURIComponent(id)}`,
  );
  if (!res.data) throw new Error("Provider not found");
  return res.data;
}

export async function createLlmProvider(
  input: LlmProviderInput,
): Promise<LlmProvider> {
  const res = await apiPost<LlmProvider>(
    "/api/v1/admin/settings/llm-providers",
    input,
  );
  if (!res.data) throw new Error("Provider create failed");
  return res.data;
}

export async function updateLlmProvider(
  id: string,
  input: Partial<LlmProviderInput>,
): Promise<LlmProvider> {
  const res = await apiPut<LlmProvider>(
    `/api/v1/admin/settings/llm-providers/${encodeURIComponent(id)}`,
    input,
  );
  if (!res.data) throw new Error("Provider update failed");
  return res.data;
}

export async function deleteLlmProvider(id: string): Promise<void> {
  await apiDelete(
    `/api/v1/admin/settings/llm-providers/${encodeURIComponent(id)}`,
  );
}

export interface LlmSyncResult {
  added: number;
  updated: number;
  removed: number;
}

export async function syncLlmProviderModels(id: string): Promise<LlmSyncResult> {
  const res = await apiPost<LlmSyncResult>(
    `/api/v1/admin/settings/llm-providers/${encodeURIComponent(id)}/sync`,
    {},
  );
  if (!res.data) throw new Error("Sync failed");
  return res.data;
}

/**
 * Patch one model's surface flags (#270 — single-source per-provider
 * model management). Server enforces:
 *   - at-most-one default per surface across all providers,
 *   - `defaultForX: true` ⇒ `enabledForX: true`,
 *   - the row cannot be `removed: true`.
 *
 * Returns the full updated provider doc (with auth secrets mid-masked).
 */
export async function patchProviderModelFlags(
  providerId: string,
  modelId: string,
  flags: ModelFlagsPatchInput,
): Promise<LlmProvider> {
  const res = await apiPatch<LlmProvider>(
    `/api/v1/admin/settings/llm-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    flags,
  );
  if (!res.data) throw new Error("Model patch failed");
  return res.data;
}

// --------------------------------------------------------------------- export / import

export interface SettingsExport {
  schemaVersion: number;
  exportedAt: string;
  ornnVersion: string;
  sections: {
    llmProviders: LlmProvider[];
    playground: PlaygroundSection;
    skillGeneration: SkillGenSection;
    mirror: MirrorSection;
    integrationsNyxid: NyxIdSection;
    integrationsServices: ServicesSection;
    skillAudit: SkillAuditSection;
    telemetry: TelemetrySection;
    quotaDefaults: QuotaDefaultsSection;
    extras: ExtrasSection;
  };
}

export interface SectionImportResult {
  status: "applied" | "skipped" | "failed";
  errors?: Array<{ field: string; message: string }>;
  changedFields?: string[];
}

export interface SettingsImportResponse {
  schemaVersion: number;
  sections: Record<string, SectionImportResult>;
  aggregateStatus: "applied" | "partial" | "failed";
}

export async function downloadSettingsExport(): Promise<{
  body: SettingsExport;
  filename: string;
}> {
  // The API returns a JSON attachment. We hit it via apiGet to reuse
  // auth + retry, then read the filename from the response payload's
  // `exportedAt` (apiGet swallows `Content-Disposition` — the filename
  // is reconstructed client-side using the same spec).
  const res = await apiGet<SettingsExport>("/api/v1/admin/settings/export");
  if (!res.data) throw new Error("Export missing");
  const iso = res.data.exportedAt.replace(/[:.]/g, "-");
  const filename = `ornn-settings-${iso}.json`;
  return { body: res.data, filename };
}

export interface ImportRequest {
  schemaVersion: number;
  sections: SettingsExport["sections"];
  /** When true the API runs validation only and returns a diff with no writes. */
  dryRun?: boolean;
}

export async function importSettings(
  payload: ImportRequest,
): Promise<SettingsImportResponse> {
  const res = await apiPost<SettingsImportResponse>(
    "/api/v1/admin/settings/import",
    payload,
  );
  if (!res.data) throw new Error("Import response missing");
  return res.data;
}
