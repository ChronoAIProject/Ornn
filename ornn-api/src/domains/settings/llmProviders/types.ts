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
   * `enabled` is what the resolver checks before serving a model. New
   * models from sync arrive with `enabled: false` so adding a row to the
   * upstream catalog never auto-changes platform behavior.
   */
  readonly enabled: boolean;
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
  readonly defaultModelId: string | null;
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
