/**
 * OpenAPI spec quality contract (#462, #1214).
 *
 * CONVENTIONS.md §10: "Every route declares security, request content
 * types, all documented error responses". §11.7: "every handler in code
 * appears in the spec with complete metadata". This file enforces the
 * *metadata* half of that promise by inspecting the generated document;
 * the *coverage* half (every registered route is documented, and nothing
 * documented is unregistered) is enforced against the booted router in
 * `openapiRoutes.test.ts`.
 *
 * Three classes of regression are pinned here, each one having actually
 * shipped at some point:
 *
 *   1. Empty schemas. `zod-to-json-schema@3` returns `{}` for every Zod 4
 *      schema without erroring. The spec published `parameters: []` for
 *      `GET /skill-search` and `schema: {}` for every body until #1214
 *      moved `toSchema` onto zod 4's built-in `z.toJSONSchema`. The
 *      "no empty schema" tests below fail loudly if that regresses.
 *   2. Wrong error media type. Errors are RFC 7807
 *      `application/problem+json` with fields at the body root (#456);
 *      the spec described them as `application/json` wrapping the legacy
 *      `{ data, error }` envelope, so generated clients read error fields
 *      at the wrong depth.
 *   3. Thin metadata — an operation with no description, a parameter with
 *      no description, an undeclared tag.
 *
 * @module tests/contract/openapi
 */

import { describe, expect, test } from "bun:test";
import { buildSpec } from "../../src/openapi/specBuilder";
import { UNVERSIONED_SYSTEM_PATHS } from "../../src/openapi/paths/system";

const SPEC_OPTIONS = { serverUrl: "https://api.test.invalid", version: "1.2.3" } as const;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

interface Response {
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

interface Operation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: Parameter[];
  requestBody?: { description?: string; required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, Response>;
}

const spec = buildSpec(SPEC_OPTIONS);
const paths = spec.paths as Record<string, Record<string, unknown>>;

function isOperation(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

interface Entry {
  path: string;
  method: HttpMethod;
  op: Operation;
  label: string;
}

const operations: Entry[] = [];
for (const [path, pathItem] of Object.entries(paths)) {
  for (const [method, op] of Object.entries(pathItem)) {
    if (!isOperation(method)) continue;
    operations.push({ path, method, op: op as Operation, label: `${method.toUpperCase()} ${path}` });
  }
}

/**
 * `/readyz` returns its 503 straight from the probe handler rather than
 * raising through the global RFC 7807 error handler, so it is the one
 * error response in the document that is plain `application/json`.
 * Documented as it behaves; pinned here so the exemption stays deliberate.
 */
const RAW_ERROR_RESPONSES = new Set(["GET /readyz 503"]);

/**
 * Operations with no failure mode to document.
 *
 * The liveness probes return a constant object — if the process cannot
 * serve them it cannot respond at all — and the spec endpoint serves a
 * value computed once at boot. Declaring a speculative 500 on these would
 * be padding, and padding is what this file exists to prevent. Keep this
 * list tiny and justified; anything that touches a dependency does not
 * belong on it.
 */
const NO_FAILURE_MODE = new Set([
  "GET /livez",
  "GET /health",
  "GET /api/v1/openapi.json",
  // Both serve a module-level constant computed once at import: the format
  // rulebook string and the SKILL.md JSON Schema. No I/O, no auth, no
  // parameters — there is nothing that can return a 4xx or 5xx.
  "GET /api/v1/skill-format/rules",
  "GET /api/v1/skill-manifest-schema.json",
]);

/** A schema object carrying no information — the zod 4 conversion bug. */
function isEmptySchema(schema: unknown): boolean {
  return (
    typeof schema === "object" &&
    schema !== null &&
    !Array.isArray(schema) &&
    Object.keys(schema as Record<string, unknown>).length === 0
  );
}

describe("OpenAPI spec — document structure", () => {
  test("is an OpenAPI 3.1 document", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  test("declares title, semver version, and a substantial description", () => {
    const info = spec.info as { title: string; version: string; description: string };
    expect(info.title).toBeTruthy();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    // The description carries the envelope / error / auth conventions an
    // integrator needs before reading a single operation.
    expect(info.description.length).toBeGreaterThan(500);
  });

  test("advertises the deployment's server URL", () => {
    const servers = spec.servers as Array<{ url: string }>;
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0]!.url).toBe(SPEC_OPTIONS.serverUrl);
  });

  test("declares the BearerAuth security scheme", () => {
    const components = spec.components as { securitySchemes: Record<string, unknown> };
    expect(components.securitySchemes.BearerAuth).toBeDefined();
  });

  test("every declared path has at least one operation", () => {
    const orphans = Object.entries(paths)
      .filter(([, item]) => Object.keys(item).filter(isOperation).length === 0)
      .map(([path]) => path);
    expect(orphans).toEqual([]);
  });

  test("every path is under /api/v1 except the K8s probes", () => {
    const strays = Object.keys(paths).filter(
      (p) => !p.startsWith("/api/v1") && !UNVERSIONED_SYSTEM_PATHS.includes(p),
    );
    expect(strays).toEqual([]);
  });

  test("the document is JSON-serialisable", () => {
    const json = JSON.stringify(spec);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test("no $schema keyword leaks into a Schema Object", () => {
    // `$schema` is valid at the root of a standalone JSON Schema document
    // but not as a keyword inside an OpenAPI Schema Object — `toSchema`
    // strips it. It IS legal as a *property name*, though: the response
    // body of `GET /skill-manifest-schema.json` is itself a JSON Schema
    // document and declares a `$schema` field. So this walks the tree and
    // only flags occurrences outside a `properties` map, rather than
    // grepping the serialised text and failing on the legitimate case.
    const leaks: string[] = [];
    const walk = (node: unknown, trail: string, inPropertiesMap: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${trail}[${i}]`, false));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "$schema" && !inPropertiesMap) leaks.push(`${trail}.${key}`);
        walk(value, `${trail}.${key}`, key === "properties");
      }
    };
    walk(spec, "", false);
    expect(leaks).toEqual([]);
  });
});

describe("OpenAPI spec — per-operation metadata", () => {
  test("every operation declares a summary", () => {
    const violations = operations.filter((e) => !e.op.summary).map((e) => e.label);
    expect(violations).toEqual([]);
  });

  test("every operation declares a description that says something", () => {
    // The bar is deliberately more than "non-empty": the reason this file
    // exists is that integrators reported the spec was too thin to build
    // against. One sentence restating the summary is not a description.
    const violations = operations
      .filter((e) => (e.op.description ?? "").length < 120)
      .map((e) => `${e.label} (${(e.op.description ?? "").length} chars)`);
    expect(violations).toEqual([]);
  });

  test("every operation declares a unique operationId", () => {
    const missing = operations.filter((e) => !e.op.operationId).map((e) => e.label);
    expect(missing).toEqual([]);

    const byId = new Map<string, string[]>();
    for (const e of operations) {
      const id = e.op.operationId!;
      byId.set(id, [...(byId.get(id) ?? []), e.label]);
    }
    const duplicates = [...byId.entries()].filter(([, labels]) => labels.length > 1);
    // Generators derive client method names from operationId; a collision
    // silently drops one of the two methods.
    expect(duplicates).toEqual([]);
  });

  test("every operation declares at least one tag, and every tag is declared at the top level", () => {
    const untagged = operations.filter((e) => !e.op.tags?.length).map((e) => e.label);
    expect(untagged).toEqual([]);

    const declared = new Set((spec.tags as Array<{ name: string }>).map((t) => t.name));
    const undeclared = [
      ...new Set(operations.flatMap((e) => e.op.tags ?? []).filter((t) => !declared.has(t))),
    ];
    expect(undeclared).toEqual([]);
  });

  test("every operation makes an explicit security declaration", () => {
    // `security: []` (public) is an answer; omitting the key is not, because
    // the operation then silently inherits whatever the document declares.
    const violations = operations.filter((e) => e.op.security === undefined).map((e) => e.label);
    expect(violations).toEqual([]);
  });
});

describe("OpenAPI spec — parameters", () => {
  test("every templated path parameter is declared in parameters", () => {
    const violations: string[] = [];
    for (const { path, op, label } of operations) {
      const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      const declared = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name);
      for (const name of templated) {
        if (!declared.includes(name)) violations.push(`${label}: {${name}}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("every parameter carries a description and a non-empty schema", () => {
    const violations: string[] = [];
    for (const { op, label } of operations) {
      for (const p of op.parameters ?? []) {
        if (!p.description) violations.push(`${label}: '${p.name}' has no description`);
        if (!p.schema) violations.push(`${label}: '${p.name}' has no schema`);
        else if (isEmptySchema(p.schema)) violations.push(`${label}: '${p.name}' has an EMPTY schema`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("path parameters are marked required", () => {
    const violations: string[] = [];
    for (const { op, label } of operations) {
      for (const p of (op.parameters ?? []).filter((x) => x.in === "path")) {
        if (p.required !== true) violations.push(`${label}: '${p.name}'`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("OpenAPI spec — request bodies", () => {
  test("every request body declares a description and non-empty content", () => {
    const violations: string[] = [];
    for (const { op, label } of operations) {
      const body = op.requestBody;
      if (!body) continue;
      if (!body.description) violations.push(`${label}: requestBody has no description`);
      const types = Object.keys(body.content ?? {});
      if (types.length === 0) violations.push(`${label}: requestBody has no content`);
      for (const type of types) {
        const schema = body.content![type]!.schema;
        if (isEmptySchema(schema)) violations.push(`${label}: requestBody ${type} has an EMPTY schema`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("OpenAPI spec — responses", () => {
  test("every operation declares a described 2xx with content (except 204)", () => {
    const violations: string[] = [];
    for (const { op, label } of operations) {
      const responses = op.responses ?? {};
      const success = Object.keys(responses).filter((c) => c.startsWith("2"));
      if (success.length === 0) {
        violations.push(`${label}: no 2xx response`);
        continue;
      }
      for (const code of success) {
        const body = responses[code]!;
        if (!body.description) violations.push(`${label}: ${code} has no description`);
        if (code === "204") continue;
        const types = Object.keys(body.content ?? {});
        if (types.length === 0) violations.push(`${label}: ${code} declares no content`);
        for (const type of types) {
          if (isEmptySchema(body.content![type]!.schema)) {
            violations.push(`${label}: ${code} ${type} has an EMPTY schema`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("every operation declares at least one error response", () => {
    const violations = operations
      .filter((e) => !NO_FAILURE_MODE.has(e.label))
      .filter((e) => !Object.keys(e.op.responses ?? {}).some((c) => /^[45]/.test(c)))
      .map((e) => e.label);
    expect(violations).toEqual([]);
  });

  test("every 4xx/5xx response is RFC 7807 application/problem+json", () => {
    const violations: string[] = [];
    for (const { op, label } of operations) {
      for (const [code, body] of Object.entries(op.responses ?? {})) {
        if (!/^[45]/.test(code)) continue;
        if (!body.description) violations.push(`${label}: ${code} has no description`);
        const types = Object.keys(body.content ?? {});
        if (types.length === 0) continue;
        if (RAW_ERROR_RESPONSES.has(`${label} ${code}`)) continue;
        if (!types.includes("application/problem+json")) {
          violations.push(`${label}: ${code} is ${types.join(", ")}, expected application/problem+json`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the problem body documents fields at the root, not inside an envelope", () => {
    // Guards the specific #456 regression: describing errors with the
    // legacy `{ data, error }` envelope makes every generated client read
    // `err.error.message` and get undefined.
    const violations: string[] = [];
    for (const { op, label } of operations) {
      for (const [code, body] of Object.entries(op.responses ?? {})) {
        if (!/^[45]/.test(code)) continue;
        const schema = body.content?.["application/problem+json"]?.schema as
          | { properties?: Record<string, unknown> }
          | undefined;
        if (!schema) continue;
        const props = schema.properties ?? {};
        for (const required of ["type", "title", "status", "detail", "code"]) {
          if (!(required in props)) violations.push(`${label}: ${code} problem body lacks '${required}'`);
        }
        if ("data" in props) violations.push(`${label}: ${code} problem body still uses the legacy envelope`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("OpenAPI spec — schema generation is not silently empty (#1214)", () => {
  // `zod-to-json-schema@3` produced `{}` for every zod 4 schema. That is
  // the failure this whole issue traced back to, and it is invisible
  // unless something asserts on it: the document stayed structurally
  // valid, it just described nothing.
  test("no operation anywhere in the document carries an empty schema object", () => {
    const violations: string[] = [];
    const visit = (node: unknown, trail: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => visit(child, `${trail}[${i}]`));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "schema" && isEmptySchema(value)) violations.push(`${trail}.${key}`);
        visit(value, `${trail}.${key}`);
      }
    };
    visit(paths, "paths");
    expect(violations).toEqual([]);
  });

  test("a representative Zod-derived response actually carries properties", () => {
    // Belt and braces: if the converter regresses to returning `{}` the
    // test above catches it, but this pins one known-good shape so the
    // failure message points straight at the cause.
    const op = paths["/api/v1/skills/{idOrName}"]?.get as Operation | undefined;
    expect(op).toBeDefined();
    const schema = op!.responses?.["200"]?.content?.["application/json"]?.schema as
      | { properties?: { data?: { properties?: Record<string, unknown> } } }
      | undefined;
    const dataProps = schema?.properties?.data?.properties ?? {};
    expect(Object.keys(dataProps).length).toBeGreaterThan(0);
  });

  test("GET /skill-search publishes its query parameters", () => {
    // The most user-visible symptom of the converter bug: the primary
    // discovery endpoint advertised `parameters: []`.
    const op = paths["/api/v1/skill-search"]?.get as Operation | undefined;
    expect(op).toBeDefined();
    const queryNames = (op!.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name);
    expect(queryNames.length).toBeGreaterThan(0);
    expect(queryNames).toContain("q");
  });
});
