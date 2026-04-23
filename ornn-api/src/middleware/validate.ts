/**
 * Request validation middleware.
 *
 * Replaces the per-route `c.req.json() → try/catch → schema.safeParse() →
 * throw AppError` boilerplate with declarative composition:
 *
 *   app.post(
 *     "/skills",
 *     auth,
 *     requirePermission("ornn:skill:create"),
 *     validateBody(skillCreateSchema, "INVALID_SKILL_BODY"),
 *     async (c) => {
 *       const data = getValidatedBody<z.infer<typeof skillCreateSchema>>(c);
 *       ...
 *     },
 *   );
 *
 * Each middleware stores its parsed value under a well-known context
 * key; handlers read it via `getValidatedBody` / `getValidatedQuery` /
 * `getValidatedParams`. Typed helpers keep route code honest without
 * forcing every handler into a generic Hono type chain.
 *
 * Error code is caller-supplied so the external contract stays stable
 * (e.g. `INVALID_TOPIC_UPDATE` remains `INVALID_TOPIC_UPDATE`). Epic 2
 * collapses the catalog; this middleware is the seam that makes the
 * one-line change possible.
 *
 * Non-JSON body routes (ZIP uploads, multipart forms) keep their
 * bespoke parsing — this middleware is for `Content-Type:
 * application/json` only.
 *
 * @module middleware/validate
 */

import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import { AppError } from "../shared/types/index";

const BODY_KEY = "validatedBody";
const QUERY_KEY = "validatedQuery";
const PARAMS_KEY = "validatedParams";

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

/**
 * Validate a JSON request body against a Zod schema. Throws 400 with
 * `errorCode` when the body is missing, not valid JSON, or fails the
 * schema.
 */
export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  errorCode: string = "INVALID_BODY",
): MiddlewareHandler {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw AppError.badRequest(errorCode, "Request body must be valid JSON");
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw AppError.badRequest(errorCode, formatIssues(result.error.issues));
    }
    c.set(BODY_KEY, result.data);
    await next();
  };
}

/**
 * Validate `c.req.query()` entries against a Zod schema. Useful for
 * list / search endpoints — the schema usually declares `z.coerce` for
 * numeric filters and optional defaults for pagination.
 */
export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  errorCode: string = "INVALID_QUERY",
): MiddlewareHandler {
  return async (c, next) => {
    const raw: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      raw[key] = value;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw AppError.badRequest(errorCode, formatIssues(result.error.issues));
    }
    c.set(QUERY_KEY, result.data);
    await next();
  };
}

/**
 * Validate path params against a Zod schema. Less commonly needed but
 * useful when a param has a constrained shape (e.g. UUID, version
 * string).
 */
export function validateParams<T extends z.ZodTypeAny>(
  schema: T,
  errorCode: string = "INVALID_PARAMS",
): MiddlewareHandler {
  return async (c, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      throw AppError.badRequest(errorCode, formatIssues(result.error.issues));
    }
    c.set(PARAMS_KEY, result.data);
    await next();
  };
}

/**
 * Typed accessor. The generic is a hint for the caller — the runtime
 * value is whatever `validateBody(...)` actually parsed. Keep the
 * generic aligned with the schema that populated it.
 */
export function getValidatedBody<T>(c: Context): T {
  return c.get(BODY_KEY) as T;
}

export function getValidatedQuery<T>(c: Context): T {
  return c.get(QUERY_KEY) as T;
}

export function getValidatedParams<T>(c: Context): T {
  return c.get(PARAMS_KEY) as T;
}
