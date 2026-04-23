import { describe, test, expect } from "bun:test";
import { RESERVED_VERBS, isReservedVerb } from "./reservedVerbs";

describe("reservedVerbs", () => {
  test("skill verbs cover the v1 action paths", () => {
    expect(RESERVED_VERBS.skill).toEqual([
      "format",
      "validate",
      "search",
      "counts",
      "generate",
      "lookup",
    ]);
  });

  test("category and tag have no reserved verbs yet", () => {
    expect(RESERVED_VERBS.category).toEqual([]);
    expect(RESERVED_VERBS.tag).toEqual([]);
  });

  test("isReservedVerb detects skill collisions", () => {
    expect(isReservedVerb("skill", "format")).toBe(true);
    expect(isReservedVerb("skill", "validate")).toBe(true);
    expect(isReservedVerb("skill", "generate")).toBe(true);
    expect(isReservedVerb("skill", "search")).toBe(true);
    expect(isReservedVerb("skill", "counts")).toBe(true);
    expect(isReservedVerb("skill", "lookup")).toBe(true);
  });

  test("isReservedVerb is case-sensitive (matches canonical kebab-case)", () => {
    expect(isReservedVerb("skill", "Format")).toBe(false);
    expect(isReservedVerb("skill", "FORMAT")).toBe(false);
  });

  test("isReservedVerb allows safe names", () => {
    expect(isReservedVerb("skill", "pdf-extract")).toBe(false);
    expect(isReservedVerb("skill", "my-skill")).toBe(false);
    expect(isReservedVerb("skill", "formatter")).toBe(false); // substring OK
  });

  test("isReservedVerb returns false for resources with no reserved verbs", () => {
    expect(isReservedVerb("category", "format")).toBe(false);
    expect(isReservedVerb("tag", "generate")).toBe(false);
  });
});
