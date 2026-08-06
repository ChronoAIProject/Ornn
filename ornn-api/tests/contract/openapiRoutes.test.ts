/**
 * OpenAPI ↔ router reflection test (#1213).
 *
 * The spec's path table in `src/openapi/specBuilder.ts` is hand-written
 * while the routes it describes are registered in `src/bootstrap.ts`.
 * Nothing structurally ties the two together, and they drifted badly:
 *
 *   - every path was published under `/api/` while the router had moved
 *     to `/api/v1/` (#101), so no URL in the spec resolved;
 *   - four `/admin/{categories,tags}` paths described endpoints that had
 *     been deleted from the codebase entirely.
 *
 * Both are the same failure: the spec claimed something the router does
 * not serve. The other contract tests could not catch it because they
 * only inspect the spec against itself. This one boots the real app and
 * checks each documented operation against the live route table.
 *
 * Direction matters. This asserts *documented ⇒ registered* — no phantom
 * endpoints. The converse (*registered ⇒ documented*, i.e. closing the
 * coverage gap) is tracked as #1214 and deliberately not enforced here;
 * turning it on today would fail on ~90 legitimately-undocumented routes.
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
  // Explicit timeout: `cleanup()` stops a MongoMemoryServer, which under
  // a loaded full-suite run regularly exceeds bun's 5s hook default. The
  // existing integration files omit this and flake because of it (#1215)
  // — this one does not pile on.
}, 30_000);

describe("OpenAPI spec — every documented operation is a real route (#1213)", () => {
  test("no declared path+method is missing from the booted router", () => {
    // `app.routes` carries one entry per handler in each chain, so the
    // same path appears once per middleware. Dedupe, and drop the `ALL`
    // entries — those are middleware mounts, not endpoints.
    const registered = new Set(
      harness.app.routes
        .filter((r) => r.method !== "ALL")
        .map((r) => `${r.method.toUpperCase()} ${r.path}`),
    );

    const spec = buildSpec(SPEC_OPTIONS);
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const missing: string[] = [];
    for (const [specPath, pathItem] of Object.entries(paths)) {
      for (const method of Object.keys(pathItem)) {
        if (!isOperation(method)) continue;
        const key = `${method.toUpperCase()} ${toHonoPath(specPath)}`;
        if (!registered.has(key)) missing.push(key);
      }
    }

    // A non-empty list means the spec is advertising an endpoint the API
    // does not serve — agents following it get a 404.
    expect(missing).toEqual([]);
  });

  test("the router actually serves the /api/v1 prefix the spec declares", () => {
    // Guards the specific regression: if the mount prefix in bootstrap.ts
    // and `prefix` in specBuilder.ts ever diverge again, the assertion
    // above goes red — but only if the router really is on /api/v1. Pin
    // that independently so a matched-but-wrong pair can't pass silently.
    const v1Routes = harness.app.routes.filter((r) => r.path.startsWith("/api/v1/"));
    expect(v1Routes.length).toBeGreaterThan(0);
  });
});
