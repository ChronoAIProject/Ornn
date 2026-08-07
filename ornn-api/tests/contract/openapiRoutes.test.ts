/**
 * OpenAPI ↔ router reflection test (#1213, #1214).
 *
 * The spec's path table is assembled in `src/openapi/paths/*.ts` while the
 * routes it describes are registered in `src/bootstrap.ts`. Nothing in the
 * type system ties the two together, and historically they drifted badly:
 *
 *   - every path was published under `/api/` while the router had moved to
 *     `/api/v1/` (#101), so no URL in the spec resolved;
 *   - four `/admin/{categories,tags}` paths described endpoints that had
 *     been deleted from the codebase entirely;
 *   - and in the other direction, 91 of 104 registered routes were absent
 *     from the document altogether (#1214).
 *
 * This file closes the loop in **both** directions, which is what makes
 * the spec trustworthy as the contract CONVENTIONS.md §10 claims it is:
 *
 *   - *documented ⇒ registered* — the spec never advertises an endpoint
 *     the API does not serve. Agents following it never get a 404.
 *   - *registered ⇒ documented* — the API never serves an endpoint the
 *     spec does not describe. Adding a route without documenting it
 *     fails CI here, so the coverage gap cannot silently reopen.
 *
 * There is deliberately no allowlist. #1214 burned the last of it down;
 * reintroducing one would restore exactly the ratchet that let coverage
 * decay to 13% in the first place.
 *
 * @module tests/contract/openapiRoutes
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHarness, type Harness } from "../integration/harness";
import { buildSpec } from "../../src/openapi/specBuilder";

const SPEC_OPTIONS = { serverUrl: "https://api.test.invalid", version: "1.2.3" } as const;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isOperation(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

/** OpenAPI templates a path param as `{id}`; Hono registers it as `:id`. */
function toHonoPath(specPath: string): string {
  return specPath.replace(/\{([^}]+)\}/g, ":$1");
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness.cleanup();
  // Explicit timeout: `cleanup()` stops a MongoMemoryServer, which under a
  // loaded full-suite run regularly exceeds bun's 5s hook default (#1215).
}, 30_000);

/**
 * Every endpoint the booted router actually serves, as `METHOD /path`.
 *
 * `app.routes` carries one entry per handler in each chain, so a path with
 * three middlewares appears three times — dedupe. `ALL` entries are
 * middleware mounts (`app.use("*", ...)`), not endpoints.
 */
function registeredRoutes(): Set<string> {
  return new Set(
    harness.app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method.toUpperCase()} ${r.path}`),
  );
}

/** Every operation the spec declares, keyed the same way. */
function documentedRoutes(): Set<string> {
  const spec = buildSpec(SPEC_OPTIONS);
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  const keys = new Set<string>();
  for (const [specPath, pathItem] of Object.entries(paths)) {
    for (const method of Object.keys(pathItem)) {
      if (!isOperation(method)) continue;
      keys.add(`${method.toUpperCase()} ${toHonoPath(specPath)}`);
    }
  }
  return keys;
}

describe("OpenAPI spec ↔ router (#1213, #1214)", () => {
  test("no documented operation is missing from the booted router", () => {
    const registered = registeredRoutes();
    const missing = [...documentedRoutes()].filter((key) => !registered.has(key)).sort();
    // Non-empty means the spec advertises an endpoint the API does not
    // serve — agents following it get a 404.
    expect(missing).toEqual([]);
  });

  test("no registered route is missing from the spec", () => {
    const documented = documentedRoutes();
    const undocumented = [...registeredRoutes()].filter((key) => !documented.has(key)).sort();
    // Non-empty means a route shipped without documentation. Add it to the
    // matching module under `src/openapi/paths/` — do NOT add an allowlist
    // here; see this file's header.
    expect(undocumented).toEqual([]);
  });

  test("the router actually serves the /api/v1 prefix the spec declares", () => {
    // Guards the specific regression: if the mount prefix in bootstrap.ts
    // and `prefix` in specBuilder.ts ever diverge again, the assertions
    // above go red — but only if the router really is on /api/v1. Pin that
    // independently so a matched-but-wrong pair cannot pass silently.
    const v1Routes = harness.app.routes.filter((r) => r.path.startsWith("/api/v1/"));
    expect(v1Routes.length).toBeGreaterThan(0);
  });

  test("the spec covers the whole surface, not a sample of it", () => {
    // A blunt floor. If someone deletes a path module and the two set
    // comparisons above are somehow both satisfied, this still fails.
    expect(documentedRoutes().size).toBe(registeredRoutes().size);
    expect(documentedRoutes().size).toBeGreaterThan(100);
  });
});
