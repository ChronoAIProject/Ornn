/**
 * Idempotency-Key middleware (CONVENTIONS.md §3.4, #459).
 *
 * On every state-changing request (`POST` / `PUT` / `PATCH` / `DELETE`)
 * carrying an `Idempotency-Key` header, the middleware fingerprints
 * `(userId, method, path, key)` and looks the fingerprint up in the
 * `idempotency_keys` Mongo collection. If a prior response is cached
 * within the 24 h TTL window, the cached body + status + headers are
 * returned verbatim with `Idempotency-Replay: true`. Otherwise the
 * handler executes and its response is persisted for the next retry.
 *
 * Industry parallels: Stripe, Square, AWS, GitHub all expose
 * `Idempotency-Key` in the same shape. Without it, an agent that
 * retries a POST after a transient network failure can create
 * duplicate skills / redemptions / notifications — a class of bug that
 * lands on the on-call to clean up manually.
 *
 * Mount order constraints:
 * - MUST run AFTER `proxyAuthSetup` so `c.var.auth.userId` is set; the
 *   fingerprint is per-user, otherwise two unrelated callers could
 *   replay each other's response with the same key.
 * - MUST run BEFORE per-route handlers so it can short-circuit on
 *   cache hits and capture handler responses on cache misses.
 *
 * @module middleware/idempotency
 */

import type { MiddlewareHandler } from "hono";
import type { Collection, Db } from "mongodb";
import { createLogger } from "../shared/logger";
const logger = createLogger("idempotency");

/** 24-hour TTL, per CONVENTIONS.md §3.4 — matches Stripe / GitHub. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Methods that mutate state. GET / HEAD / OPTIONS are idempotent by definition. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Idempotency-Key values are arbitrary client strings. We refuse keys
 * over this length to prevent unbounded growth of fingerprint indexes
 * and to surface obvious bugs (e.g. an agent stuffing a full body into
 * the header).
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** 5xx responses are transient — replaying a server error doesn't help. */
function shouldCache(status: number): boolean {
  return status < 500;
}

export interface IdempotencyKeyDoc {
  /** Composite fingerprint: `${userId}:${method}:${path}:${key}`. */
  _id: string;
  key: string;
  userId: string;
  method: string;
  path: string;
  responseStatus: number;
  /**
   * Response body as a UTF-8 string. Non-text payloads (e.g. ZIP
   * downloads) get base64-encoded; `responseEncoding` tracks the form.
   * The 16 MiB Mongo doc limit easily covers every JSON response we
   * emit today and tomorrow.
   */
  responseBody: string;
  responseEncoding: "utf-8" | "base64";
  responseHeaders: Record<string, string>;
  createdAt: Date;
}

export class IdempotencyKeyRepository {
  private readonly col: Collection<IdempotencyKeyDoc>;

  constructor(db: Db) {
    this.col = db.collection<IdempotencyKeyDoc>("idempotency_keys");
  }

  async ensureIndexes(): Promise<void> {
    // Mongo TTL monitor sweeps once per minute; documents are deleted
    // when `createdAt + expireAfterSeconds < now`. The composite `_id`
    // already gives unique-key replay protection.
    await this.col.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: IDEMPOTENCY_TTL_SECONDS, name: "createdAt_ttl" },
    );
  }

  async find(id: string): Promise<IdempotencyKeyDoc | null> {
    return await this.col.findOne({ _id: id });
  }

  /**
   * Insert with duplicate-key tolerance. Two concurrent requests with
   * the same key race here — one wins, the other's identical handler
   * output is silently discarded. Returns `false` on the loser's path
   * so the caller knows it didn't persist.
   */
  async insert(doc: IdempotencyKeyDoc): Promise<{ inserted: boolean }> {
    try {
      await this.col.insertOne(doc);
      return { inserted: true };
    } catch (err: unknown) {
      const code = (err as { code?: number } | null)?.code;
      if (code === 11000) {
        return { inserted: false };
      }
      throw err;
    }
  }
}

function fingerprint(userId: string, method: string, path: string, key: string): string {
  return `${userId}:${method}:${path}:${key}`;
}

function captureHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

/**
 * Test seam: lets callers inject a custom date for deterministic TTL
 * assertions. Production callers leave it as `Date.now()`.
 */
function nowProvider(): Date {
  return new Date();
}

export interface IdempotencyConfig {
  repo: IdempotencyKeyRepository;
  /** Override for tests. */
  now?: () => Date;
}

export function idempotencyMiddleware(config: IdempotencyConfig): MiddlewareHandler {
  const { repo, now = nowProvider } = config;

  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const rawKey = c.req.header("Idempotency-Key");

    // Not applicable: safe method (GET / HEAD / OPTIONS) or no key.
    if (!MUTATING_METHODS.has(method) || !rawKey) {
      return next();
    }

    const key = rawKey.trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      // Malformed keys fall through and don't cache. Returning 400
      // here would be more strict but creates a new failure mode for
      // every existing caller as soon as the middleware ships.
      logger.debug({ keyLength: key.length, path: c.req.path }, "Idempotency key rejected");
      return next();
    }

    const auth = (c.get as unknown as (k: "auth") => { userId?: string } | undefined)("auth");
    const userId = auth?.userId ?? "anonymous";
    const path = c.req.path;
    const id = fingerprint(userId, method, path, key);

    const cached = await repo.find(id);
    if (cached) {
      logger.info({ id, userId, method, path, status: cached.responseStatus }, "Idempotency replay");
      const replayHeaders = new Headers(cached.responseHeaders);
      replayHeaders.set("Idempotency-Replay", "true");
      const body =
        cached.responseEncoding === "base64"
          ? Uint8Array.from(atob(cached.responseBody), (ch) => ch.charCodeAt(0))
          : cached.responseBody;
      return new Response(body, {
        status: cached.responseStatus,
        headers: replayHeaders,
      });
    }

    await next();

    // Capture and persist the handler's response. The store happens
    // BEFORE the function returns — synchronous persistence is the
    // only way to guarantee that a retry arriving 10 ms later sees the
    // cached entry, which is the entire point of the feature. (A
    // fire-and-forget write would race the retry.)
    const res: Response | undefined = c.res;
    if (!res || !shouldCache(res.status)) {
      return;
    }

    try {
      const responseHeaders = captureHeaders(res);
      const contentType = responseHeaders["content-type"] ?? "";
      let body: string;
      let encoding: "utf-8" | "base64";
      if (contentType.startsWith("application/") || contentType.startsWith("text/")) {
        // Clone before reading so the original response stream is
        // still consumable by the actual client.
        body = await res.clone().text();
        encoding = "utf-8";
      } else {
        // Binary — base64-encode for storage. Empty bodies (e.g. 204)
        // round-trip as empty strings either way.
        const buffer = await res.clone().arrayBuffer();
        body = bufferToBase64(new Uint8Array(buffer));
        encoding = "base64";
      }

      const doc: IdempotencyKeyDoc = {
        _id: id,
        key,
        userId,
        method,
        path,
        responseStatus: res.status,
        responseBody: body,
        responseEncoding: encoding,
        responseHeaders,
        createdAt: now(),
      };
      const { inserted } = await repo.insert(doc);
      if (!inserted) {
        logger.debug({ id }, "Idempotency persist lost a race");
      }
    } catch (err) {
      // Persistence failure must NEVER fail the request. The client
      // gets a correct response; the only cost is no replay protection
      // if the same retry happens before the TTL window.
      logger.warn({ err, id }, "Idempotency persist failed");
    }
  };
}

/**
 * Cross-runtime base64 encode for `Uint8Array`. Bun + Node have
 * different globals available; this works in both without pulling in
 * the `buffer` shim explicitly.
 */
function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
