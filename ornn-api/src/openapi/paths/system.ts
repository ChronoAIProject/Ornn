/**
 * Service-level endpoints: the machine-readable contract itself and the
 * Kubernetes probes (#1214).
 *
 * These are the only operations in the spec that do not live behind the
 * `/api/v1` prefix — the probes are registered on the root Hono app in
 * `bootstrap.ts`, deliberately outside the versioned surface so an API
 * version bump never moves a liveness URL out from under a running
 * deployment.
 *
 * They are also the only operations whose bodies are NOT wrapped in the
 * `{ data, error }` envelope, and `/readyz` is the one endpoint whose
 * failure response is plain `application/json` rather than RFC 7807 —
 * it returns its 503 directly instead of throwing through the global
 * error handler. Documented as it actually behaves, not as convention
 * would prefer.
 *
 * @module openapi/paths/system
 */

import {
  publicAuth,
  rawJsonResponse,
  type JsonSchema,
  type PathMap,
} from "../helpers";

const probeBody: JsonSchema = {
  type: "object",
  required: ["status", "service", "version", "timestamp"],
  properties: {
    status: { type: "string", enum: ["ok"], description: "Always `ok` — the handler only runs if the process is alive." },
    service: { type: "string", enum: ["ornn-api"], description: "Service identity, so a probe pointed at the wrong pod is obvious." },
    version: { type: "string", description: "Running ornn-api package version.", examples: ["0.16.1"] },
    timestamp: { type: "string", format: "date-time", description: "Server clock at the moment of the check (ISO 8601, UTC)." },
  },
};

const readyBody: JsonSchema = {
  type: "object",
  required: ["status", "service", "mongoLatencyMs"],
  properties: {
    status: { type: "string", enum: ["ready"] },
    service: { type: "string", enum: ["ornn-api"] },
    mongoLatencyMs: {
      type: "integer",
      description: "Round-trip time of the MongoDB `ping` this probe just issued, in milliseconds.",
    },
  },
};

const notReadyBody: JsonSchema = {
  type: "object",
  required: ["status", "reason"],
  properties: {
    status: { type: "string", enum: ["not_ready"] },
    reason: { type: "string", enum: ["mongo_unreachable"], description: "Which dependency failed the readiness check." },
  },
};

function livenessOperation(operationId: string, summary: string, description: string): Record<string, unknown> {
  return {
    summary,
    description,
    operationId,
    tags: ["System"],
    security: publicAuth(),
    responses: rawJsonResponse(probeBody, "The process is alive and serving."),
  };
}

export function systemPaths(prefix: string): PathMap {
  return {
    [`${prefix}/openapi.json`]: {
      get: {
        summary: "Fetch this OpenAPI document",
        description:
          "Returns the complete OpenAPI 3.1 description of the `/api/v1` surface — the same document you are reading. This is the contract's source of truth (CONVENTIONS.md §10): it is generated at boot from the server's own Zod schemas, so it cannot drift from the running validators. Agents and code generators should fetch this at integration time rather than pinning a vendored copy. The body is the raw OpenAPI document at the root — it is not wrapped in the `{ data, error }` envelope that the rest of the API uses. Public; no authentication required. `info.version` reports the running ornn-api release and `servers[0].url` reports this deployment's public base URL, so the document is self-locating.",
        operationId: "getOpenApiSpec",
        tags: ["System"],
        security: publicAuth(),
        responses: rawJsonResponse(
          { type: "object", description: "An OpenAPI 3.1 document." },
          "The OpenAPI 3.1 document describing this API.",
        ),
      },
    },

    "/livez": {
      get: livenessOperation(
        "getLiveness",
        "Liveness probe",
        "Kubernetes liveness probe. Returns 200 as long as the process can serve a request; it performs **no** dependency checks, so it stays green while MongoDB or the LLM gateway are down. Use `/readyz` to decide whether a pod should receive traffic, and this one only to decide whether it should be restarted. Public, uncached, cheap enough to poll on a one-second interval.",
      ),
    },

    "/health": {
      get: livenessOperation(
        "getHealth",
        "Liveness probe (deprecated alias)",
        "Backward-compatible alias for `/livez`, serving the identical handler and body. Retained for deployments whose manifests still point here. New integrations should use `/livez`; this path is kept for compatibility and may be removed in a future major version.",
      ),
    },

    "/readyz": {
      get: {
        summary: "Readiness probe",
        description:
          "Kubernetes readiness probe. Issues a MongoDB `ping` with a 2-second timeout and reports whether this instance can actually serve dependent traffic. Returns 200 with the observed ping latency when the database answers, and 503 when it does not, so the pod is drained from the load balancer until it recovers. Unlike every other endpoint, the 503 body here is plain `application/json` with `{ status, reason }` — it is returned directly rather than raised through the global RFC 7807 error handler. Public and unauthenticated.",
        operationId: "getReadiness",
        tags: ["System"],
        security: publicAuth(),
        responses: {
          ...rawJsonResponse(readyBody, "MongoDB answered the ping — this instance is ready for traffic."),
          503: {
            description:
              "A required dependency is unreachable (MongoDB did not answer within 2 seconds). Not RFC 7807 — this response is emitted directly by the probe handler.",
            content: { "application/json": { schema: notReadyBody } },
          },
        },
      },
    },
  };
}

/**
 * Exported for the contract test: the probe paths intentionally sit outside
 * `/api/v1`, so the "every documented path carries the version prefix"
 * assertion has to know about them explicitly rather than inferring it.
 */
export const UNVERSIONED_SYSTEM_PATHS: readonly string[] = ["/livez", "/health", "/readyz"];
