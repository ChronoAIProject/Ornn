/**
 * LLM provider domain types. Stored as one document per provider in the
 * `llm_providers` collection (Architecture §3.4).
 *
 * Authentication shape is a discriminated union; secret fields end in
 * `Enc` when stored (ciphertext). The service layer decrypts on read,
 * encrypts on write, and never exposes plaintext on GET — secrets are
 * mid-masked via `infra/crypto`.
 *
 * @module domains/settings/llmProviders/types
 */

export type ApiFormat = "chat-completion" | "responses";

export interface LlmProviderModel {
  /** Provider-issued model id, e.g. `gpt-4o`, `claude-sonnet-4-6`. */
  readonly id: string;
  /** Operator-friendly display name. Defaults to `id` if missing. */
  readonly displayName: string;
  /**
   * Per-surface enable flags. Resolver reads these — the model is
   * usable on a surface iff `enabledFor<Surface>` is true AND
   * `removed === false`. New models from sync arrive with both flags
   * false so a freshly-discovered model never auto-changes platform
   * behavior.
   */
  readonly enabledForPlayground: boolean;
  readonly enabledForSkillGen: boolean;
  /** #970 — Ornn Assistant surface (repo-aware Q&A chatbot). */
  readonly enabledForAssistant: boolean;
  /**
   * Per-surface default flags. Server enforces at-most-one-true
   * across **all providers** — setting a default on one model clears
   * it on every other model (this provider or any other) for the
   * same surface in the same write. Setting `defaultForX: true`
   * also forces `enabledForX: true` (a default that isn't enabled
   * is incoherent).
   */
  readonly defaultForPlayground: boolean;
  readonly defaultForSkillGen: boolean;
  /** #970 — Ornn Assistant surface default. */
  readonly defaultForAssistant: boolean;
  /**
   * `removed` flips to true when a previously-known model disappears
   * from the upstream catalog. Kept for history / lifetime breakdowns;
   * resolver excludes removed=true rows.
   */
  readonly removed: boolean;
  readonly firstSeenAt: Date;
  readonly lastSyncedAt: Date;
}

export type ApiKeyAuth = { readonly kind: "apiKey"; readonly apiKey: string };

export type TokenUrlAuth = {
  readonly kind: "tokenUrl";
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type BasicAuth = {
  readonly kind: "basic";
  readonly username: string;
  readonly password: string;
};

export type LlmProviderAuth = ApiKeyAuth | TokenUrlAuth | BasicAuth;

/** Decrypted form returned by service to internal callers. */
export interface LlmProvider {
  readonly _id: string;
  readonly name: string;
  readonly gatewayUrl: string;
  readonly modelListUrl: string;
  readonly apiFormat: ApiFormat;
  readonly auth: LlmProviderAuth;
  readonly models: ReadonlyArray<LlmProviderModel>;
  readonly maxOutputTokens: number;
  readonly defaultTemperature: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

/** Field names treated as secrets per auth kind. */
export const PROVIDER_SECRET_FIELDS = {
  apiKey: ["apiKey"] as const,
  tokenUrl: ["clientSecret"] as const,
  basic: ["password"] as const,
} as const;
