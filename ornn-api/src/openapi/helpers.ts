/**
 * Shared building blocks for the OpenAPI 3.1 spec (#1214).
 *
 * Every per-domain path module under `openapi/paths/` composes its
 * operations from these helpers so the whole spec speaks one dialect:
 * one success envelope, one RFC 7807 error shape, one auth scheme, one
 * way of turning a Zod schema into query parameters.
 *
 * Two wire shapes matter and they are NOT the same:
 *
 *   - success (2xx) — `{ data: T, error: null }` (CONVENTIONS.md §1.2)
 *   - failure (4xx/5xx) — RFC 7807 fields at the body root, served as
 *     `application/problem+json` (CONVENTIONS.md §1.3, #456)
 *
 * The pre-#1214 builder described errors with the legacy `{ data, error }`
 * envelope under `application/json`, which no longer matches what
 * `app.onError` in bootstrap.ts emits. Generated clients built from that
 * spec parsed error bodies at the wrong depth. `problemResponses()` is
 * the fix — it is the only sanctioned way to declare a non-2xx response.
 *
 * @module openapi/helpers
 */

import { z, type ZodTypeAny } from "zod";

export type JsonSchema = Record<string, unknown>;
export type Operation = Record<string, unknown>;
export type PathItem = Record<string, unknown>;
export type PathMap = Record<string, PathItem>;

// ---------------------------------------------------------------------------
// Zod → JSON Schema
// ---------------------------------------------------------------------------

/**
 * Which side of the wire a schema describes.
 *
 * `input` — what a client sends. Fields carrying a Zod `.default()` are
 * optional, because the client may omit them.
 * `output` — what the server sends back. Defaulted fields are always
 * present, so they are required.
 */
export type SchemaDirection = "input" | "output";

/**
 * Convert a Zod schema to an inline JSON Schema for embedding in the spec.
 *
 * Uses Zod 4's first-party `z.toJSONSchema`. The previous implementation
 * called `zod-to-json-schema@3`, which only understands Zod 3 internals:
 * against this codebase's Zod 4 schemas it returned `{}` for *every*
 * schema without erroring. The published spec consequently advertised
 * `parameters: []` for `GET /skill-search` and `schema: {}` for every
 * request and response body — the concrete reason integrators reported
 * that parameters and field descriptions were missing. Do not reintroduce
 * that dependency — `helpers.test.ts` and the "schema generation is not
 * silently empty" block in `tests/contract/openapi.test.ts` both pin
 * non-empty output.
 *
 * OpenAPI 3.1 is a superset of JSON Schema draft 2020-12, so the emitted
 * schemas are valid Schema Objects as-is.
 *
 * One sharp edge worth knowing: a schema ending in `.transform()` is a
 * `ZodPipe`, and only its **input** side has a JSON Schema representation.
 * `direction: "output"` yields `{}` for such a field. That is correct for
 * request bodies and query strings (which are input) and a trap for
 * responses — if a response schema ever ends in a transform, describe the
 * emitted shape by hand rather than publishing an empty object. The
 * "no empty schema" assertions in `tests/contract/openapi.test.ts` catch
 * it if anyone tries.
 */
export function toSchema(zodSchema: ZodTypeAny, direction: SchemaDirection = "output"): JsonSchema {
  const result = z.toJSONSchema(zodSchema, {
    target: "draft-2020-12",
    io: direction,
    // Emit `{}` for types with no JSON Schema equivalent (z.date, z.bigint,
    // z.custom) instead of throwing and taking the whole spec down.
    unrepresentable: "any",
    // Inline a schema used in several places rather than hoisting it into
    // `$defs`. Keeps every operation self-contained: no pointer chasing for
    // a human reader, and no `$ref`-resolution bugs in third-party
    // generators. True cycles still fall back to `$ref` — they must.
    reused: "inline",
  }) as JsonSchema;

  // `$schema` is meaningful in a standalone JSON Schema document but is not
  // a valid key inside an OpenAPI Schema Object.
  delete result.$schema;

  // `io: "output"` stamps `additionalProperties: false` on every object.
  // That is accurate today but hostile to clients tomorrow: any field we
  // add server-side would fail strict client-side validation against a
  // cached spec. Responses are documented as open, which is what an
  // evolving API contract should promise.
  if (direction === "output") stripAdditionalPropertiesFalse(result);

  return result;
}

/** Recursively drop `additionalProperties: false`. See `toSchema`. */
function stripAdditionalPropertiesFalse(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) stripAdditionalPropertiesFalse(child);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  if (obj.additionalProperties === false) delete obj.additionalProperties;
  for (const value of Object.values(obj)) stripAdditionalPropertiesFalse(value);
}

// ---------------------------------------------------------------------------
// Success responses
// ---------------------------------------------------------------------------

/**
 * Wrap a payload schema in the standard success envelope.
 *
 * Built structurally rather than with a Zod combinator so callers can
 * pass either a Zod schema or a hand-written JSON Schema fragment.
 */
export function envelope(data: JsonSchema): JsonSchema {
  return {
    type: "object",
    required: ["data", "error"],
    properties: {
      data,
      error: {
        type: "null",
        description: "Always null on a 2xx response. Failures use the RFC 7807 body instead.",
      },
    },
  };
}

export interface JsonResponseOptions {
  /** HTTP status. Defaults to 200; creates should pass 201. */
  readonly status?: number;
  /** Example of the `data` payload — embedded inside the envelope. */
  readonly example?: unknown;
  /** Response headers worth documenting (e.g. `ETag`, `Cache-Control`). */
  readonly headers?: Record<string, unknown>;
}

/**
 * Declare a JSON success response whose body is the standard envelope.
 * `schema` describes the `data` payload only — the envelope is added here.
 */
export function jsonResponse(
  schema: ZodTypeAny | JsonSchema,
  description: string,
  options: JsonResponseOptions = {},
): Record<string, unknown> {
  const dataSchema = isZod(schema) ? toSchema(schema) : schema;
  const content: Record<string, unknown> = { schema: envelope(dataSchema) };
  if (options.example !== undefined) {
    content.example = { data: options.example, error: null };
  }
  const response: Record<string, unknown> = {
    description,
    content: { "application/json": content },
  };
  if (options.headers) response.headers = options.headers;
  return { [String(options.status ?? 200)]: response };
}

/**
 * Declare a JSON success response whose body is NOT enveloped — the
 * payload sits at the body root. Only for endpoints that deliberately
 * opt out (e.g. the SKILL.md manifest JSON Schema, which external
 * schema-store tooling consumes raw).
 */
export function rawJsonResponse(
  schema: JsonSchema,
  description: string,
  options: { status?: number; mediaType?: string; headers?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    description,
    content: { [options.mediaType ?? "application/json"]: { schema } },
  };
  if (options.headers) response.headers = options.headers;
  return { [String(options.status ?? 200)]: response };
}

/** Declare a binary (file download) success response. */
export function binaryResponse(
  description: string,
  mediaType = "application/octet-stream",
  headers?: Record<string, unknown>,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    description,
    content: { [mediaType]: { schema: { type: "string", format: "binary" } } },
  };
  if (headers) response.headers = headers;
  return { 200: response };
}

/**
 * Declare a Server-Sent Events response.
 *
 * `events` documents the discriminated event names the stream can emit.
 * SSE has no schema language in OpenAPI, so the event vocabulary lives
 * in the description where a human or an agent will actually read it.
 */
/**
 * How a stream lays out its SSE frames. The two surfaces genuinely differ,
 * and a client that dispatches on the wrong one silently receives nothing:
 *
 * - `data-only` — payload frames carry no `event:` line, so the consumer
 *   must dispatch on the JSON body's own `type` field. Used by the
 *   generation and playground streams.
 * - `named-events` — each frame carries both an `event:` line and the JSON
 *   `data:` line, so `EventSource.addEventListener(<type>)` works. Used by
 *   the assistant stream.
 */
export type SseFrameStyle = "data-only" | "named-events";

const FRAME_STYLE_TEXT: Record<SseFrameStyle, string> = {
  "data-only":
    "SSE frame stream. Payload frames are `data: <json>\\n\\n` with **no** `event:` line — dispatch on the JSON body's own `type` field, not on an event name. Keep-alive frames are sent periodically to hold the connection open and MUST be ignored.",
  "named-events":
    "SSE frame stream. Each payload frame carries both an `event: <type>` line and a `data: <json>` line, so either `EventSource.addEventListener(<type>)` or dispatching on the JSON `type` field works. Comment frames (`: keepalive`) are sent periodically to hold the connection open and MUST be ignored.",
};

export function sseResponse(
  description: string,
  events: readonly string[] = [],
  frameStyle: SseFrameStyle = "data-only",
): Record<string, unknown> {
  const eventList = events.length > 0
    ? ` Event types: ${events.map((e) => `\`${e}\``).join(", ")}.`
    : "";
  return {
    200: {
      description: `${description}${eventList}`,
      content: {
        "text/event-stream": {
          schema: { type: "string", description: FRAME_STYLE_TEXT[frameStyle] },
        },
      },
    },
  };
}

/** Declare a 204 No Content success response. */
export function noContentResponse(description: string): Record<string, unknown> {
  return { 204: { description } };
}

// ---------------------------------------------------------------------------
// Error responses (RFC 7807)
// ---------------------------------------------------------------------------

/**
 * The RFC 7807 body emitted by `app.onError` in bootstrap.ts. Kept in
 * lockstep with `ProblemJsonBody` in `shared/types/index.ts` — if that
 * interface changes, this must change with it.
 */
export const problemJsonSchema: JsonSchema = {
  type: "object",
  required: ["type", "title", "status", "detail", "instance", "code", "requestId"],
  properties: {
    type: {
      type: "string",
      format: "uri",
      description: "URI identifying the error class. Dereference for documentation on this error.",
    },
    title: {
      type: "string",
      description: "Short, human-readable summary of the error class. Stable per status code.",
    },
    status: {
      type: "integer",
      description: "HTTP status code, repeated in the body so it survives logging and proxying.",
    },
    detail: {
      type: "string",
      description: "Human-readable explanation specific to this occurrence. Safe to surface to end users.",
    },
    instance: {
      type: "string",
      description: "Request path that produced the error.",
    },
    code: {
      type: "string",
      description:
        "Machine-readable error code (e.g. `skill_not_found`, `validation_error`). Branch on this, never on `detail`.",
    },
    requestId: {
      type: ["string", "null"],
      description: "Correlation id, echoed in the `X-Request-ID` response header. Quote it in bug reports.",
    },
  },
};
// Deliberately NOT documented here: an `errors[]` array. `ProblemJsonBody`
// in `shared/types/index.ts` declares the field as optional, but nothing
// populates it — `buildProblemJsonBody` never sets it, and `validateBody`
// flattens the Zod issues into `detail` as `<path>: <message>` pairs joined
// with "; " (middleware/validate.ts `formatIssues`). Documenting a field the
// server never emits is what sent integrators looking for it in the first
// place. If per-field errors are ever emitted for real, add the property
// here and in `buildProblemJsonBody` in the same change.

/**
 * Default `detail` copy per status. Domain modules override these via
 * `problemResponses({ 404: "..." })` when the generic wording would lose
 * information an integrator needs.
 */
const DEFAULT_PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: "Bad request — the body, query, or path failed validation. `detail` names the rejected fields as `<path>: <message>` pairs joined with `; `.",
  401: "Unauthorized — missing, expired, or invalid bearer token. Obtain a fresh token from NyxID and retry.",
  403: "Forbidden — authenticated, but the caller lacks the permission or ownership this operation requires.",
  404: "Not found — no such resource, or it exists but is not visible to this caller. Private resources return 404 rather than 403 so their existence is not leaked.",
  405: "Method not allowed for this path.",
  409: "Conflict — the request collides with existing state (e.g. duplicate name, concurrent modification).",
  410: "Gone — the resource existed but has been permanently removed.",
  413: "Payload too large — the upload exceeds the server's configured maximum package size.",
  415: "Unsupported media type — send one of the `Content-Type` values this operation declares.",
  422: "Unprocessable — syntactically valid but semantically rejected.",
  429: "Rate limited — too many requests. Back off and retry; consult `Retry-After` when present.",
  500: "Internal server error — unexpected failure. Retry with backoff; quote `requestId` if it persists.",
  502: "Bad gateway — an upstream dependency returned an invalid response.",
  503: "Service unavailable — a required dependency (LLM gateway, storage, sandbox) is down or unconfigured. Retry with backoff.",
  504: "Gateway timeout — an upstream dependency did not respond in time.",
};

/**
 * Declare one or more RFC 7807 error responses.
 *
 * Accepts either bare status codes or a `{ status: description }` map so
 * a domain can explain *why* this particular operation returns a 409
 * without losing the shared body schema:
 *
 *   problemResponses(401, 404)
 *   problemResponses(400, { 409: "A skill with this name already exists." })
 */
export function problemResponses(
  ...codes: Array<number | Record<number, string>>
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  const add = (code: number, description?: string): void => {
    map[String(code)] = {
      description: description ?? DEFAULT_PROBLEM_DESCRIPTIONS[code] ?? `Error ${code}.`,
      content: {
        "application/problem+json": { schema: problemJsonSchema },
      },
    };
  };
  for (const entry of codes) {
    if (typeof entry === "number") add(entry);
    else for (const [code, description] of Object.entries(entry)) add(Number(code), description);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** Operation requires a NyxID bearer token. */
export function bearerAuth(): Record<string, unknown>[] {
  return [{ BearerAuth: [] }];
}

/**
 * Operation is reachable without credentials but returns a richer or
 * wider result when a token is supplied (visibility-scoped listings).
 * `{}` is the OpenAPI idiom for "no security is also acceptable".
 */
export function optionalAuth(): Record<string, unknown>[] {
  return [{}, { BearerAuth: [] }];
}

/** Operation is unauthenticated by design. `[]` disables inherited security. */
export function publicAuth(): Record<string, unknown>[] {
  return [];
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * Expand an object Zod schema into an array of `in: query` parameters,
 * preserving per-field `.describe()` text, defaults, and enums, and
 * marking as required exactly the fields Zod marks required.
 */
export function queryParams(schema: ZodTypeAny): unknown[] {
  // Request side: a field with a `.default()` is optional for the caller.
  const jsonSchema = toSchema(schema, "input") as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  if (!jsonSchema.properties) return [];
  const required = new Set(jsonSchema.required ?? []);
  return Object.entries(jsonSchema.properties).map(([name, prop]) => {
    const { description, ...rest } = prop as { description?: string } & JsonSchema;
    const param: Record<string, unknown> = {
      name,
      in: "query",
      required: required.has(name),
      schema: description === undefined ? rest : { ...rest, description },
    };
    if (description !== undefined) param.description = description;
    return param;
  });
}

/** A single hand-written query parameter. */
export function queryParam(
  name: string,
  description: string,
  schema: JsonSchema = { type: "string" },
  required = false,
): Record<string, unknown> {
  return { name, in: "query", required, description, schema };
}

/** A path parameter. Path params are always required per the OpenAPI spec. */
export function pathParam(
  name: string,
  description: string,
  schema: JsonSchema = { type: "string" },
  example?: unknown,
): Record<string, unknown> {
  const param: Record<string, unknown> = { name, in: "path", required: true, description, schema };
  if (example !== undefined) param.example = example;
  return param;
}

/** A header parameter. */
export function headerParam(
  name: string,
  description: string,
  required = false,
  schema: JsonSchema = { type: "string" },
): Record<string, unknown> {
  return { name, in: "header", required, description, schema };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** A required `application/json` request body described by a Zod schema. */
export function jsonBody(
  schema: ZodTypeAny | JsonSchema,
  description: string,
  options: { required?: boolean; example?: unknown } = {},
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    // Request side: `.default()` fields are optional for the caller.
    schema: isZod(schema) ? toSchema(schema, "input") : schema,
  };
  if (options.example !== undefined) content.example = options.example;
  return {
    required: options.required ?? true,
    description,
    content: { "application/json": content },
  };
}

/** An `application/zip` binary request body (skill package upload). */
export function zipBody(description: string): Record<string, unknown> {
  return {
    required: true,
    description,
    content: { "application/zip": { schema: { type: "string", format: "binary" } } },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isZod(value: ZodTypeAny | JsonSchema): value is ZodTypeAny {
  return typeof (value as { safeParse?: unknown }).safeParse === "function";
}
