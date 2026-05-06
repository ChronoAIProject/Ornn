/**
 * Universal API audit middleware.
 *
 * Mounted at the top of `/api/v1/*` so every request lands here on the
 * way in and out. Captures one record per request:
 *
 *   - On the inbound side: timestamp, method, raw path, query string,
 *     truncated source IP, user agent, the auth hint (set by the auth
 *     setup middleware), and the per-route `auditConfig` (if the route
 *     declared one). The request body is read up-front via a buffered
 *     clone so the downstream handler still sees a fresh JSON-parseable
 *     body.
 *
 *   - On the outbound side: status, duration, route pattern, response
 *     body (when the response is small enough to materialize). Both
 *     bodies are run through redaction (per-route whitelist + global
 *     blacklist), then either embedded inline (read 200s = metadata
 *     only; small bodies on writes/4xx/5xx) or offloaded to MinIO.
 *
 * The middleware is **fail-isolated**: any thrown error inside the
 * audit pipeline is swallowed (logged at `error`) so the original
 * response always reaches the client unchanged. Mongo down or MinIO
 * down both manifest as missing audit records, never 500s.
 *
 * @module middleware/audit/middleware
 */

import type { MiddlewareHandler } from "hono";
import { ulid } from "./ulid";
import pino from "pino";
import type { IAuditBodyStorage } from "./bodyStorage";
import type { ApiAuditRepository } from "./repository";
import {
  resolveCallerType,
  type CallerTypeAuthHint,
} from "./callerType";
import { resolveSourceIp } from "./headers";
import { redactBody, buildBlacklistRegex } from "./redaction";
import type {
  AuditBodyRef,
  AuditDocument,
  AuditVariables,
  RouteAuditConfig,
} from "./types";

/**
 * Caller hint resolver — kept as a configuration injection so the
 * middleware does not hard-couple to the NyxID auth shape. Tests pass a
 * stub; production passes a function that reads `c.var.auth`.
 */
export type AuthHintResolver = (c: AuditMiddlewareContext) => CallerTypeAuthHint & {
  callerIdentity: string | null;
};

/**
 * Minimal Hono context surface the auth resolver needs. Defined here so
 * the middleware module doesn't pull the full `AuthVariables` type from
 * `nyxidAuth`.
 */
export interface AuditMiddlewareContext {
  get(key: string): unknown;
}

export interface AuditMiddlewareConfig {
  readonly repository: ApiAuditRepository;
  readonly bodyStorage: IAuditBodyStorage;
  readonly bodyInlineMaxBytes: number;
  /** Header-name patterns to add to the global blacklist. */
  readonly extraBlacklistPatterns: readonly string[];
  readonly resolveAuthHint: AuthHintResolver;
  /**
   * Logger override — tests pass a captured logger; production uses
   * the bootstrap logger so all audit lines route to the same sink.
   */
  readonly logger?: pino.Logger;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const HEADER_HINT_NAME = "X-Ornn-Caller";

/**
 * Build the audit middleware. The factory pattern lets bootstrap inject
 * the storage + repository + auth-resolver dependencies once and reuse
 * the same `MiddlewareHandler` across all requests.
 */
export function auditMiddleware(
  config: AuditMiddlewareConfig,
): MiddlewareHandler<{ Variables: AuditVariables }> {
  const logger = config.logger ?? pino({ level: "info" }).child({ module: "auditMiddleware" });
  const blacklist = buildBlacklistRegex(config.extraBlacklistPatterns);

  return async (c, next) => {
    const auditId = ulid();
    const start = Date.now();
    const startedAt = new Date(start);

    // ---- Inbound capture (before next()) -------------------------
    // Buffer the body so we can read + redact it AND let the handler
    // re-parse the same content. We clone the underlying `Request`
    // before `text()`-ing so the handler's `c.req.json()` still sees
    // an unconsumed body.
    let capturedReqText: string | null = null;
    if (WRITE_METHODS.has(c.req.method)) {
      try {
        capturedReqText = await c.req.raw.clone().text();
      } catch (err) {
        // Body already consumed or non-text — accept that we can't
        // capture it. The audit record will note req body as null;
        // the request itself proceeds untouched.
        logger.debug({ err, auditId }, "audit: req body not captured");
      }
    }

    const headerHint = c.req.header(HEADER_HINT_NAME) ?? null;
    const sourceIp = resolveSourceIp({
      forwardedFor: c.req.header("X-Forwarded-For") ?? null,
      realIp: c.req.header("X-Real-IP") ?? null,
      remoteAddr: null,
    });
    const userAgent = c.req.header("User-Agent") ?? null;

    // ---- Run the downstream handler ------------------------------
    let responseError: unknown = null;
    try {
      await next();
    } catch (err) {
      // Re-throw at the end so the global error handler converts it
      // to a JSON response. Audit still captures whatever status the
      // error handler eventually sets on c.res.
      responseError = err;
    }

    const durationMs = Date.now() - start;
    const status = c.res.status;
    const routePath = safeRoutePath(c) ?? c.req.path;

    // ---- Outbound capture (after next() / handler ran) -----------
    // Decide first whether we even keep the bodies. Read 200s store
    // metadata only — saves Mongo + MinIO traffic for the dominant
    // request shape on a busy API.
    const isWrite = WRITE_METHODS.has(c.req.method);
    const isErrorStatus = status >= 400;
    const keepBodies = isWrite || isErrorStatus;

    // Capture response body lazily. We clone the response so we don't
    // drain the stream the client is still reading. When `keepBodies`
    // is false we skip the clone+read entirely.
    //
    // SSE responses are excluded: `await clone().text()` here would
    // wait for the entire stream to drain before this middleware
    // returns, which Hono interprets as "response not ready yet" and
    // holds the response from the client. Net effect: the client
    // receives all SSE events in one batch at the end instead of
    // token-by-token. Audits for streaming endpoints record metadata
    // only (status, duration, route, request body); the response
    // body is intentionally null for these — capturing N thousand
    // tokens per chat into Mongo / MinIO would be costly and not
    // particularly useful.
    const resContentType = c.res.headers.get("content-type") ?? "";
    const isSseResponse = resContentType.toLowerCase().includes("text/event-stream");
    let capturedResText: string | null = null;
    if (keepBodies && !isSseResponse) {
      try {
        capturedResText = await c.res.clone().text();
      } catch (err) {
        logger.debug({ err, auditId }, "audit: res body not captured");
      }
    }

    // The audit pipeline is fire-and-forget. A thrown error here must
    // never block returning the response to the client — the catch on
    // the call site below logs and discards.
    void persistAudit({
      logger,
      config,
      auditId,
      record: {
        startedAt,
        durationMs,
        method: c.req.method,
        rawPath: c.req.path,
        routePath,
        queryString: extractQueryString(c.req.url),
        sourceIp,
        userAgent,
        headerHint,
        keepBodies,
        capturedReqText,
        capturedResText,
        status,
      },
      auditConfig: c.get("auditConfig") as RouteAuditConfig | undefined,
      authResolver: config.resolveAuthHint,
      contextLike: c as unknown as AuditMiddlewareContext,
      blacklist,
    }).catch((err) => {
      logger.error({ err, auditId, path: c.req.path }, "audit pipeline failed");
    });

    if (responseError) {
      throw responseError;
    }
  };
}

interface PersistInput {
  readonly logger: pino.Logger;
  readonly config: AuditMiddlewareConfig;
  readonly auditId: string;
  readonly record: {
    readonly startedAt: Date;
    readonly durationMs: number;
    readonly method: string;
    readonly rawPath: string;
    readonly routePath: string;
    readonly queryString: string | null;
    readonly sourceIp: string;
    readonly userAgent: string | null;
    readonly headerHint: string | null;
    readonly keepBodies: boolean;
    readonly capturedReqText: string | null;
    readonly capturedResText: string | null;
    readonly status: number;
  };
  readonly auditConfig: RouteAuditConfig | undefined;
  readonly authResolver: AuthHintResolver;
  readonly contextLike: AuditMiddlewareContext;
  readonly blacklist: RegExp;
}

/**
 * Build + persist the audit document. Errors here are caught at the
 * `persistAudit().catch(...)` site upstream so the middleware chain
 * always unwinds cleanly.
 */
async function persistAudit(input: PersistInput): Promise<void> {
  const {
    logger,
    config,
    auditId,
    record,
    auditConfig,
    authResolver,
    contextLike,
    blacklist,
  } = input;

  // Caller-type resolution
  const authShape = authResolver(contextLike);
  const callerResolution = resolveCallerType(
    { hasAuth: authShape.hasAuth, hasForwardedUserToken: authShape.hasForwardedUserToken },
    record.headerHint,
  );

  // Body redaction (req + res). The whitelists are pulled per-side from
  // the route's `auditConfig`. Empty / unset whitelist means "redact
  // everything" — the safe default.
  const reqWhitelist = new Set(auditConfig?.req ?? []);
  const resWhitelist = new Set(auditConfig?.res ?? []);

  const reqParsed = parseJson(record.capturedReqText);
  const resParsed = parseJson(record.capturedResText);

  const reqRedacted = reqParsed === undefined
    ? null
    : redactBody(reqParsed, reqWhitelist, blacklist);
  const resRedacted = resParsed === undefined
    ? null
    : redactBody(resParsed, resWhitelist, blacklist);

  // Decide inline-vs-MinIO per side. Read-200 responses don't store
  // any body at all (per spec), regardless of size.
  const reqRef = await resolveBodyRef({
    auditId,
    side: "req",
    keep: record.keepBodies,
    redacted: reqRedacted?.value,
    inlineMaxBytes: config.bodyInlineMaxBytes,
    storage: config.bodyStorage,
    logger,
  });
  const resRef = await resolveBodyRef({
    auditId,
    side: "res",
    keep: record.keepBodies,
    redacted: resRedacted?.value,
    inlineMaxBytes: config.bodyInlineMaxBytes,
    storage: config.bodyStorage,
    logger,
  });

  const redactedFields = mergeRedactedFields([
    reqRedacted?.redactedFields ?? [],
    resRedacted?.redactedFields ?? [],
  ]);

  const bodyOffloadFailed =
    Boolean(reqRef.bodyOffloadFailed) || Boolean(resRef.bodyOffloadFailed);

  const doc: AuditDocument = {
    _id: auditId,
    timestamp: record.startedAt,
    durationMs: record.durationMs,
    method: record.method,
    path: record.routePath,
    rawPath: record.rawPath,
    queryString: record.queryString,
    sourceIp: record.sourceIp,
    userAgent: record.userAgent,
    callerIdentity: authShape.callerIdentity,
    callerType: callerResolution.callerType,
    headerHint: callerResolution.headerHint,
    callerTypeMismatch: callerResolution.callerTypeMismatch,
    status: record.status,
    reqBodyRef: reqRef.ref,
    resBodyRef: resRef.ref,
    redactedFields,
    ...(bodyOffloadFailed ? { bodyOffloadFailed: true } : {}),
  };

  await config.repository.insert(doc);

  // Single audit-line Pino info log per request.
  logger.info(
    {
      audit_id: auditId,
      path: record.routePath,
      status: record.status,
      durationMs: record.durationMs,
      callerType: callerResolution.callerType,
    },
    "api audit",
  );
  if (callerResolution.callerTypeMismatch) {
    logger.warn(
      {
        audit_id: auditId,
        path: record.routePath,
        callerType: callerResolution.callerType,
        headerHint: callerResolution.headerHint,
      },
      "callerType mismatch",
    );
  }
}

interface BodyRefResolution {
  readonly ref: AuditBodyRef | null;
  readonly bodyOffloadFailed?: boolean;
}

interface BodyRefInput {
  readonly auditId: string;
  readonly side: "req" | "res";
  readonly keep: boolean;
  readonly redacted: unknown;
  readonly inlineMaxBytes: number;
  readonly storage: IAuditBodyStorage;
  readonly logger: pino.Logger;
}

/**
 * Decide whether to embed the redacted body inline, offload to MinIO,
 * or skip storing it entirely. The decision matrix:
 *
 *   - `keep=false` (read 200) → null. Spec says metadata-only.
 *   - body absent (no captured text) → null.
 *   - body small (post-redaction JSON byte length ≤ inlineMaxBytes) →
 *     inline.
 *   - else → MinIO. On MinIO failure, `bodyOffloadFailed: true` and
 *     ref left null.
 */
async function resolveBodyRef(input: BodyRefInput): Promise<BodyRefResolution> {
  if (!input.keep || input.redacted === undefined || input.redacted === null) {
    return { ref: null };
  }
  const json = JSON.stringify(input.redacted ?? null);
  const byteLength = Buffer.byteLength(json, "utf-8");
  if (byteLength <= input.inlineMaxBytes) {
    return { ref: { kind: "inline", data: input.redacted } };
  }
  try {
    const { key } = await input.storage.put({
      auditId: input.auditId,
      side: input.side,
      body: input.redacted,
    });
    return { ref: { kind: "minio", key } };
  } catch (err) {
    input.logger.error(
      { err, auditId: input.auditId, side: input.side, byteLength },
      "audit body offload failed",
    );
    return { ref: null, bodyOffloadFailed: true };
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // Non-JSON body — keep a small text preview so the audit record is
    // informative, but don't try to redact something we can't
    // structurally reason about.
    if (raw.length <= 1024) return { raw };
    return { raw: `${raw.slice(0, 1024)}…[truncated ${raw.length - 1024} chars]` };
  }
}

function mergeRedactedFields(lists: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const l of lists) {
    for (const name of l) set.add(name);
  }
  return Array.from(set).sort();
}

function extractQueryString(url: string): string | null {
  const idx = url.indexOf("?");
  if (idx < 0) return null;
  const qs = url.slice(idx + 1);
  return qs.length > 0 ? qs : null;
}

/** `c.req.routePath` may be unset before any matched handler. Defensive. */
function safeRoutePath(c: { req: { routePath?: string } }): string | null {
  try {
    const rp = c.req.routePath;
    return typeof rp === "string" && rp.length > 0 ? rp : null;
  } catch {
    return null;
  }
}
