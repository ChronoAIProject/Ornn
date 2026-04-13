/**
 * Environment variable configuration for ornn-api.
 * Fails fast on missing required variables.
 * @module infra/config
 */

import pino from "pino";

const logger = pino({ level: "error" });

export interface SkillConfig {
  // Service
  readonly port: number;
  readonly logLevel: string;
  readonly logPretty: boolean;

  // NyxID
  readonly nyxidJwksUrl: string;
  readonly nyxidIssuer: string;
  readonly nyxidAudience: string;
  readonly nyxidIntrospectionUrl: string;
  readonly nyxidTokenUrl: string;
  readonly nyxidClientId: string;
  readonly nyxidClientSecret: string;

  // Nyx Provider (LLM Gateway)
  readonly nyxLlmGatewayUrl: string;

  // MongoDB
  readonly mongodbUri: string;
  readonly mongodbDb: string;

  // chrono-storage
  readonly storageServiceUrl: string;
  readonly storageBucket: string;

  // chrono-sandbox
  readonly sandboxServiceUrl: string;

  // LLM defaults
  readonly defaultLlmModel: string;
  readonly llmMaxOutputTokens: number;
  readonly llmTemperature: number;
  readonly sseKeepAliveIntervalMs: number;

  // Skill package
  readonly maxPackageSizeBytes: number;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    logger.fatal({ key }, `Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): SkillConfig {
  return {
    // Service
    port: Number(optionalEnv("PORT", "3802")),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
    logPretty: optionalEnv("LOG_PRETTY", "false") === "true",

    // NyxID
    nyxidJwksUrl: requiredEnv("NYXID_JWKS_URL"),
    nyxidIssuer: requiredEnv("NYXID_ISSUER"),
    nyxidAudience: requiredEnv("NYXID_AUDIENCE"),
    nyxidIntrospectionUrl: requiredEnv("NYXID_INTROSPECTION_URL"),
    nyxidTokenUrl: requiredEnv("NYXID_TOKEN_URL"),
    nyxidClientId: requiredEnv("NYXID_CLIENT_ID"),
    nyxidClientSecret: requiredEnv("NYXID_CLIENT_SECRET"),

    // Nyx Provider
    nyxLlmGatewayUrl: requiredEnv("NYX_LLM_GATEWAY_URL"),

    // MongoDB
    mongodbUri: requiredEnv("MONGODB_URI"),
    mongodbDb: optionalEnv("MONGODB_DB", "ornn"),

    // chrono-storage
    storageServiceUrl: requiredEnv("STORAGE_SERVICE_URL"),
    storageBucket: optionalEnv("STORAGE_BUCKET", "ornn"),

    // chrono-sandbox
    sandboxServiceUrl: requiredEnv("SANDBOX_SERVICE_URL"),

    // LLM defaults
    defaultLlmModel: optionalEnv("DEFAULT_LLM_MODEL", "gpt-4o"),
    llmMaxOutputTokens: Number(optionalEnv("LLM_MAX_OUTPUT_TOKENS", "8192")),
    llmTemperature: Number(optionalEnv("LLM_TEMPERATURE", "0.7")),
    sseKeepAliveIntervalMs: Number(optionalEnv("SSE_KEEP_ALIVE_INTERVAL_MS", "15000")),

    // Skill package
    maxPackageSizeBytes: Number(optionalEnv("MAX_PACKAGE_SIZE_BYTES", "52428800")),
  };
}
