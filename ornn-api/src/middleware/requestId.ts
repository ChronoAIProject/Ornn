/**
 * Request-ID middleware.
 *
 * Generates or echoes an `X-Request-ID` header on every request. The id
 * is exposed as a response header on both success and error paths and
 * attached to the Hono context as `requestId` so handlers / loggers can
 * correlate entries with a single request.
 *
 * Client-provided IDs are accepted verbatim (common when the request
 * enters via an ingress / proxy that already generated one). When the
 * request has no id, the server generates `req_<32-hex>`.
 *
 * Must run before logging middleware so that every log line carries the
 * correlation id.
 *
 * @module middleware/requestId
 */

import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";

const HEADER_NAME = "X-Request-ID";

export interface RequestIdVariables {
  requestId: string;
}

export function requestIdMiddleware(): MiddlewareHandler<{ Variables: RequestIdVariables }> {
  return async (c, next) => {
    const incoming = c.req.header(HEADER_NAME);
    const id = incoming?.trim() || `req_${randomUUID().replace(/-/g, "")}`;
    c.set("requestId", id);
    c.header(HEADER_NAME, id);
    await next();
  };
}

/**
 * Best-effort accessor for use in error handlers and logging middleware.
 * Returns empty string when no middleware has attached an id, which should
 * only happen for static routes outside the `/api/*` mount.
 */
export function getRequestId(c: { get: (key: string) => unknown }): string {
  const value = c.get("requestId");
  return typeof value === "string" ? value : "";
}
