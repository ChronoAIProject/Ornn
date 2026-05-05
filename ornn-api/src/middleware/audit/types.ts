/**
 * Universal API audit — type definitions.
 *
 * The audit subsystem is a Hono middleware that captures one structured
 * record per `/api/v1/*` request. Records carry redacted metadata + body
 * (when applicable) and are persisted to MongoDB; large or write-op bodies
 * spill to MinIO. Read-only callers (admin dashboard, forensics, replay)
 * use these types to deserialize stored records — they are part of the
 * stable contract.
 *
 * @module middleware/audit/types
 */

/**
 * Caller types tracked by the audit subsystem. The set is fixed by the
 * spec: enrichment (e.g. distinguishing CI from human-web) is intentionally
 * out of scope here — admin tooling layers richer classification on top.
 */
export type CallerType = "web" | "agent" | "anonymous";

/**
 * Pointer to the body content for a single audit record. `inline` keeps
 * the redacted payload in the Mongo document; `minio` stores only the
 * object key — the actual bytes live in `${MINIO_AUDIT_BUCKET}/<key>`.
 */
export type AuditBodyRef =
  | { kind: "inline"; data: unknown }
  | { kind: "minio"; key: string };

/**
 * Per-route audit configuration. Routes opt into preserving specific
 * field names from the request / response bodies. Anything *not* listed
 * is replaced with the redacted-string sentinel (or dropped from arrays
 * of primitives, depending on shape). The global blacklist always wins
 * over the per-route whitelist — secrets are never persisted even when
 * the route mistakenly lists them.
 */
export interface RouteAuditConfig {
  /** Whitelisted field names from the request body. */
  readonly req?: readonly string[];
  /** Whitelisted field names from the response body. */
  readonly res?: readonly string[];
}

/**
 * Persisted audit document. Mirrors the spec's MongoDB schema. `_id` is
 * a string ULID so the same value can be referenced from MinIO object
 * keys and Pino log lines without round-tripping through `ObjectId`.
 */
export interface AuditDocument {
  /** ULID — also used as the audit_id in logs and MinIO keys. */
  readonly _id: string;
  /** Request received time. Used as the TTL anchor. */
  readonly timestamp: Date;
  /** Total time the handler held the request (ms). */
  readonly durationMs: number;
  readonly method: string;
  /**
   * Best-effort route pattern (e.g. `/api/v1/skills/:idOrName`). When the
   * matched route can't be inferred from Hono's request context, falls
   * back to `rawPath`.
   */
  readonly path: string;
  /** Actual path with values substituted. */
  readonly rawPath: string;
  readonly queryString: string | null;
  /**
   * Truncated source IP. IPv4 last octet is zeroed (`a.b.c.0`); IPv6 last
   * 80 bits zeroed (`<48-bit prefix>::`). Empty string when the upstream
   * didn't provide a usable address.
   */
  readonly sourceIp: string;
  readonly userAgent: string | null;
  /** NyxID userId, or null when the caller is anonymous. */
  readonly callerIdentity: string | null;
  readonly callerType: CallerType;
  /** Raw value of `X-Ornn-Caller`. Untrusted hint, not auth ground truth. */
  readonly headerHint: string | null;
  /** True when the header hint disagrees with the authentication shape. */
  readonly callerTypeMismatch: boolean;
  readonly status: number;
  readonly reqBodyRef: AuditBodyRef | null;
  readonly resBodyRef: AuditBodyRef | null;
  /** Field names that were redacted, sorted, deduped — for transparency. */
  readonly redactedFields: readonly string[];
  /**
   * True when the offload to MinIO failed and the body had to be dropped
   * to keep the audit doc writable. Surfaces in admin tooling so operators
   * can correlate with MinIO outage windows.
   */
  readonly bodyOffloadFailed?: boolean;
}

/** Hono context variables the middleware sets / reads. */
export type AuditVariables = {
  /**
   * Per-route audit configuration. Routes opt in to preserving specific
   * fields by setting `c.set("auditConfig", { req: [...], res: [...] })`
   * inside their handler — typically right at the top, before any work.
   * Anything left unset means "redact everything" (safe default).
   */
  auditConfig?: RouteAuditConfig;
};
