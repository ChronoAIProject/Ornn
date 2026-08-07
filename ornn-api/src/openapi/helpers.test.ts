/**
 * Unit tests for the OpenAPI helper layer (#1214).
 *
 * The single most important assertion in this file is that `toSchema`
 * produces a populated schema. Its predecessor — `zod-to-json-schema@3`
 * against zod 4 schemas — returned `{}` for everything without throwing,
 * so the spec stayed structurally valid while describing nothing at all.
 * Nothing caught it because nothing asserted on schema *content*.
 *
 * @module openapi/helpers.test
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  bearerAuth,
  binaryResponse,
  envelope,
  jsonBody,
  jsonResponse,
  noContentResponse,
  optionalAuth,
  pathParam,
  problemResponses,
  publicAuth,
  queryParam,
  queryParams,
  rawJsonResponse,
  sseResponse,
  toSchema,
  zipBody,
} from "./helpers";

const sample = z.object({
  q: z.string().describe("Search text"),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Page size"),
  scope: z.enum(["public", "private", "mixed"]).optional().describe("Visibility filter"),
});

describe("toSchema", () => {
  test("emits properties, types, and descriptions from a zod 4 schema", () => {
    const schema = toSchema(sample) as {
      type?: string;
      properties?: Record<string, { type?: string; description?: string }>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(["q", "limit", "scope"]);
    expect(schema.properties!.q!.type).toBe("string");
    expect(schema.properties!.q!.description).toBe("Search text");
  });

  test("preserves numeric bounds, defaults, and enum members", () => {
    const schema = toSchema(sample) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(schema.properties.limit!.minimum).toBe(1);
    expect(schema.properties.limit!.maximum).toBe(100);
    expect(schema.properties.limit!.default).toBe(20);
    expect(schema.properties.scope!.enum).toEqual(["public", "private", "mixed"]);
  });

  test("input direction leaves defaulted fields optional; output requires them", () => {
    // A caller may omit `limit` (the server fills it in), but every
    // response carries it. Conflating the two mislabels half the fields
    // in a generated client.
    const input = toSchema(sample, "input") as { required?: string[] };
    const output = toSchema(sample, "output") as { required?: string[] };
    expect(input.required).toEqual(["q"]);
    expect(output.required).toEqual(["q", "limit"]);
  });

  test("strips $schema, which is not valid inside an OpenAPI Schema Object", () => {
    expect(toSchema(sample).$schema).toBeUndefined();
  });

  test("response schemas stay open to new fields", () => {
    // `additionalProperties: false` on a response is hostile to forward
    // compatibility: adding a field server-side would fail strict client
    // validation against a cached spec.
    expect(JSON.stringify(toSchema(sample, "output"))).not.toContain("additionalProperties");
  });

  test("does not throw on types with no JSON Schema equivalent", () => {
    const withDate = z.object({ at: z.date().describe("timestamp") });
    expect(() => toSchema(withDate)).not.toThrow();
  });

  test("inlines a schema reused in two places rather than emitting $defs", () => {
    const inner = z.object({ name: z.string() });
    const json = JSON.stringify(toSchema(z.object({ a: inner, b: inner })));
    expect(json).not.toContain("$defs");
    expect(json).not.toContain("$ref");
  });
});

describe("success responses", () => {
  test("envelope wraps the payload in { data, error }", () => {
    const wrapped = envelope({ type: "string" }) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(wrapped.required).toEqual(["data", "error"]);
    expect(wrapped.properties.data).toEqual({ type: "string" });
  });

  test("jsonResponse defaults to 200 and honours an explicit status", () => {
    expect(Object.keys(jsonResponse(sample, "ok"))).toEqual(["200"]);
    expect(Object.keys(jsonResponse(sample, "created", { status: 201 }))).toEqual(["201"]);
  });

  test("jsonResponse nests the payload schema under data and never leaves it empty", () => {
    const response = jsonResponse(sample, "ok") as Record<
      string,
      { content: Record<string, { schema: { properties: { data: Record<string, unknown> } } }> }
    >;
    const data = response["200"]!.content["application/json"]!.schema.properties.data;
    expect(Object.keys(data.properties as object).length).toBeGreaterThan(0);
  });

  test("jsonResponse wraps a supplied example in the envelope", () => {
    const response = jsonResponse(sample, "ok", { example: { q: "pdf" } }) as Record<
      string,
      { content: Record<string, { example: unknown }> }
    >;
    expect(response["200"]!.content["application/json"]!.example).toEqual({
      data: { q: "pdf" },
      error: null,
    });
  });

  test("rawJsonResponse does not envelope, and honours a media type", () => {
    const response = rawJsonResponse({ type: "object" }, "schema doc", {
      mediaType: "application/schema+json",
    }) as Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
    const content = response["200"]!.content["application/schema+json"]!;
    expect(content.schema).toEqual({ type: "object" });
  });

  test("binaryResponse and noContentResponse produce the expected shapes", () => {
    const binary = binaryResponse("the ZIP", "application/zip") as Record<
      string,
      { content: Record<string, { schema: { format: string } }> }
    >;
    expect(binary["200"]!.content["application/zip"]!.schema.format).toBe("binary");
    expect(Object.keys(noContentResponse("deleted"))).toEqual(["204"]);
  });

  test("sseResponse lists the event vocabulary in its description", () => {
    const response = sseResponse("Generation stream", ["token", "error"]) as Record<
      string,
      { description: string }
    >;
    expect(response["200"]!.description).toContain("`token`");
    expect(response["200"]!.description).toContain("`error`");
  });
});

describe("problemResponses", () => {
  test("uses application/problem+json with RFC 7807 fields at the body root", () => {
    const responses = problemResponses(404) as Record<
      string,
      { content: Record<string, { schema: { properties: Record<string, unknown> } }> }
    >;
    const schema = responses["404"]!.content["application/problem+json"]!.schema;
    for (const field of ["type", "title", "status", "detail", "instance", "code", "requestId"]) {
      expect(schema.properties[field]).toBeDefined();
    }
    // The legacy envelope must not come back — clients would read error
    // fields one level too deep.
    expect(schema.properties.data).toBeUndefined();
  });

  test("accepts bare codes and per-operation detail overrides together", () => {
    const responses = problemResponses(401, { 409: "A skill with this name already exists." }) as Record<
      string,
      { description: string }
    >;
    expect(Object.keys(responses).sort()).toEqual(["401", "409"]);
    expect(responses["409"]!.description).toBe("A skill with this name already exists.");
    expect(responses["401"]!.description).toContain("Unauthorized");
  });

  test("every generated error response carries a description", () => {
    const responses = problemResponses(400, 403, 404, 500) as Record<string, { description: string }>;
    for (const body of Object.values(responses)) expect(body.description.length).toBeGreaterThan(0);
  });
});

describe("security helpers", () => {
  test("distinguish required, optional, and absent authentication", () => {
    expect(bearerAuth()).toEqual([{ BearerAuth: [] }]);
    // `{}` is the OpenAPI idiom for "no security is also acceptable".
    expect(optionalAuth()).toEqual([{}, { BearerAuth: [] }]);
    // `[]` disables inherited security rather than omitting the key.
    expect(publicAuth()).toEqual([]);
  });
});

describe("parameters", () => {
  test("queryParams expands a zod object into described query parameters", () => {
    const params = queryParams(sample) as Array<{
      name: string;
      in: string;
      required: boolean;
      description?: string;
      schema: Record<string, unknown>;
    }>;
    expect(params.map((p) => p.name)).toEqual(["q", "limit", "scope"]);
    expect(params.every((p) => p.in === "query")).toBe(true);
    expect(params.every((p) => p.description !== undefined)).toBe(true);
    expect(params.every((p) => Object.keys(p.schema).length > 0)).toBe(true);
  });

  test("queryParams marks only zod-required fields as required", () => {
    const params = queryParams(sample) as Array<{ name: string; required: boolean }>;
    expect(params.find((p) => p.name === "q")!.required).toBe(true);
    // Defaulted and optional fields are both optional for the caller.
    expect(params.find((p) => p.name === "limit")!.required).toBe(false);
    expect(params.find((p) => p.name === "scope")!.required).toBe(false);
  });

  test("pathParam is always required and carries its description", () => {
    const param = pathParam("idOrName", "Skill UUID or unique name", { type: "string" }, "web-summarizer");
    expect(param.required).toBe(true);
    expect(param.in).toBe("path");
    expect(param.example).toBe("web-summarizer");
    expect(param.description).toBe("Skill UUID or unique name");
  });

  test("queryParam defaults to an optional string", () => {
    const param = queryParam("cursor", "Opaque pagination cursor");
    expect(param.required).toBe(false);
    expect(param.schema).toEqual({ type: "string" });
  });
});

describe("request bodies", () => {
  test("jsonBody is required by default and describes itself", () => {
    const body = jsonBody(sample, "The search request") as {
      required: boolean;
      description: string;
      content: Record<string, { schema: { properties: Record<string, unknown> } }>;
    };
    expect(body.required).toBe(true);
    expect(body.description).toBe("The search request");
    expect(Object.keys(body.content["application/json"]!.schema.properties).length).toBeGreaterThan(0);
  });

  test("jsonBody uses the input direction, so defaulted fields stay optional", () => {
    const body = jsonBody(sample, "d") as {
      content: Record<string, { schema: { required?: string[] } }>;
    };
    expect(body.content["application/json"]!.schema.required).toEqual(["q"]);
  });

  test("zipBody declares a binary application/zip payload", () => {
    const body = zipBody("The skill package") as {
      content: Record<string, { schema: { format: string } }>;
    };
    expect(body.content["application/zip"]!.schema.format).toBe("binary");
  });
});
