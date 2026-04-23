import { describe, test, expect } from "bun:test";
import {
  skillSearchQuerySchema,
  generateQuerySchema,
} from "./schemas";

describe("skillSearchQuerySchema", () => {
  test("defaults_allOptional_producesDefaults", () => {
    const result = skillSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe("");
      expect(result.data.mode).toBe("keyword");
      expect(result.data.scope).toBe("private");
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(9);
    }
  });

  test("query_provided_passesThrough", () => {
    const result = skillSearchQuerySchema.safeParse({ query: "find me a skill" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe("find me a skill");
    }
  });

  test("mode_similarity_passes", () => {
    const result = skillSearchQuerySchema.safeParse({ mode: "similarity" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("similarity");
    }
  });

  test("mode_invalid_fails", () => {
    const result = skillSearchQuerySchema.safeParse({ mode: "vector" });
    expect(result.success).toBe(false);
  });

  test("scope_public_passes", () => {
    const result = skillSearchQuerySchema.safeParse({ scope: "public" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe("public");
    }
  });

  test("scope_mixed_passes", () => {
    const result = skillSearchQuerySchema.safeParse({ scope: "mixed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe("mixed");
    }
  });

  test("scope_invalid_fails", () => {
    const result = skillSearchQuerySchema.safeParse({ scope: "all" });
    expect(result.success).toBe(false);
  });

  test("page_coercedFromString_passes", () => {
    const result = skillSearchQuerySchema.safeParse({ page: "3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
    }
  });

  test("page_lessThanOne_fails", () => {
    const result = skillSearchQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  test("pageSize_coercedFromString_passes", () => {
    const result = skillSearchQuerySchema.safeParse({ pageSize: "20" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(20);
    }
  });

  test("pageSize_greaterThan100_fails", () => {
    const result = skillSearchQuerySchema.safeParse({ pageSize: 101 });
    expect(result.success).toBe(false);
  });

  test("query_tooLong_fails", () => {
    const result = skillSearchQuerySchema.safeParse({ query: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });
});

describe("generateQuerySchema", () => {
  test("validQuery_passes", () => {
    const result = generateQuerySchema.safeParse({ query: "Create a PDF parser skill" });
    expect(result.success).toBe(true);
  });

  test("emptyQuery_fails", () => {
    const result = generateQuerySchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  test("queryTooLong_fails", () => {
    const result = generateQuerySchema.safeParse({ query: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  test("missingQuery_fails", () => {
    const result = generateQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
