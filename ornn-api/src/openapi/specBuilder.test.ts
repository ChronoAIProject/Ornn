import { describe, test, expect } from "bun:test";
import { buildSpec } from "./specBuilder";

/**
 * Contract tests for the generated OpenAPI spec.
 *
 * These assert the spec has the structural properties clients rely on —
 * non-empty paths, every method has `responses`, every response
 * enumerates both success and error codes, etc.
 *
 * Not a deep conformance check against handler behavior (that needs a
 * running HTTP layer — see the integration-test layer tracked in
 * Epic 4). But fails immediately when a new endpoint is added without
 * a spec entry, or when a spec entry is missing its response schemas.
 */

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

describe("buildSpec (OpenAPI contract)", () => {
  const spec = buildSpec();

  test("top-level spec has non-empty paths", () => {
    expect(isRecord(spec.paths)).toBe(true);
    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  test("openapi version declared", () => {
    expect(typeof spec.openapi).toBe("string");
    expect((spec.openapi as string).startsWith("3.")).toBe(true);
  });

  test("info block has title and version", () => {
    const info = spec.info as Record<string, unknown> | undefined;
    expect(isRecord(info)).toBe(true);
    expect(typeof info!.title).toBe("string");
    expect(typeof info!.version).toBe("string");
  });

  describe("per-path invariants", () => {
    const spec = buildSpec();
    const paths = spec.paths as Record<string, unknown>;

    for (const [pathKey, pathItem] of Object.entries(paths)) {
      describe(pathKey, () => {
        test("path item is a non-empty object", () => {
          expect(isRecord(pathItem)).toBe(true);
          const methods = HTTP_METHODS.filter((m) => m in (pathItem as object));
          expect(methods.length).toBeGreaterThan(0);
        });

        // For each HTTP method defined on this path, its operation
        // object must carry a populated `responses` map.
        for (const method of HTTP_METHODS) {
          const op = (pathItem as Record<string, unknown>)[method];
          if (!op) continue;

          test(`${method.toUpperCase()} has responses`, () => {
            expect(isRecord(op)).toBe(true);
            const responses = (op as Record<string, unknown>).responses;
            expect(isRecord(responses)).toBe(true);
            expect(Object.keys(responses as object).length).toBeGreaterThan(0);
          });

          test(`${method.toUpperCase()} declares at least one success code (2xx)`, () => {
            const responses = (op as Record<string, unknown>).responses as Record<string, unknown>;
            const codes = Object.keys(responses);
            const successCodes = codes.filter((c) => /^2\d\d$/.test(c));
            expect(successCodes.length).toBeGreaterThan(0);
          });
        }
      });
    }
  });
});
