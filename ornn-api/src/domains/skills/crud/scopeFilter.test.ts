/**
 * Unit tests for the extracted scope + filter match-stage builders (#969).
 *
 * These pin the visibility matrix + registry-chip filters in isolation so
 * the skillsets repository — which reuses the same two functions — inherits
 * a verified contract. The repository integration tests
 * (`crud/repository.test.ts`) still exercise them against a real Mongo.
 *
 * @module domains/skills/crud/scopeFilter.test
 */

import { describe, expect, it } from "bun:test";
import { applyScope, applyExtraFilters } from "./scopeFilter";

describe("applyScope (#969 extract)", () => {
  it("public scope matches only public docs", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "public", "u1", []);
    expect(m).toEqual({ isPrivate: false });
  });

  it("mine scope for an anonymous caller matches nothing", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "mine", "", []);
    expect(m).toEqual({ _id: { $in: [] } });
  });

  it("mine scope narrows to the caller's authored docs", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "mine", "u1", ["org-a"]);
    expect(m).toEqual({ createdBy: "u1" });
  });

  it("private scope for an anonymous caller matches nothing", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "private", "", []);
    expect(m).toEqual({ _id: { $in: [] } });
  });

  it("private scope unions author / shared-user / shared-org grants", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "private", "u1", ["org-a"]);
    expect(m.isPrivate).toBe(true);
    expect(m.$or).toEqual([
      { createdBy: "u1" },
      { sharedWithUsers: "u1" },
      { sharedWithOrgs: { $in: ["org-a"] } },
    ]);
  });

  it("shared-with-me excludes the caller's own authored docs", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "shared-with-me", "u1", ["org-a"]);
    expect(m.isPrivate).toBe(true);
    expect(m.$and).toEqual([
      { $or: [{ sharedWithUsers: "u1" }, { sharedWithOrgs: { $in: ["org-a"] } }] },
      { createdBy: { $ne: "u1" } },
    ]);
  });

  it("mixed scope unions public OR readable-private", () => {
    const m: Record<string, unknown> = {};
    applyScope(m, "mixed", "u1", []);
    expect(m.$or).toEqual([
      { isPrivate: false },
      { isPrivate: true, $or: [{ createdBy: "u1" }, { sharedWithUsers: "u1" }] },
    ]);
  });
});

describe("applyExtraFilters (#969 extract)", () => {
  it("is a no-op when filters are undefined", () => {
    const m: Record<string, unknown> = { isPrivate: false };
    applyExtraFilters(m, undefined);
    expect(m).toEqual({ isPrivate: false });
  });

  it("appends a tags $all AND-clause", () => {
    const m: Record<string, unknown> = {};
    applyExtraFilters(m, { tagsAll: ["alpha", "beta"] });
    expect(m.$and).toEqual([{ "metadata.tags": { $all: ["alpha", "beta"] } }]);
  });

  it("systemFilter only / exclude map to the right predicate", () => {
    const only: Record<string, unknown> = {};
    applyExtraFilters(only, { systemFilter: "only" });
    expect(only.$and).toEqual([{ isSystemSkill: true }]);

    const exclude: Record<string, unknown> = {};
    applyExtraFilters(exclude, { systemFilter: "exclude" });
    expect(exclude.$and).toEqual([{ isSystemSkill: { $ne: true } }]);
  });

  it("composes onto an existing $and rather than clobbering it", () => {
    const m: Record<string, unknown> = { $and: [{ name: "x" }] };
    applyExtraFilters(m, { createdByAny: ["u1"] });
    expect(m.$and).toEqual([{ name: "x" }, { createdBy: { $in: ["u1"] } }]);
  });
});
