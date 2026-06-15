/**
 * Unit tests for the typed access-grant helpers (#1123).
 *
 * Pins the grant algebra — effective-grant resolution, the legacy
 * derive/project round-trip (the non-disruption invariant), and
 * normalization — in isolation so the authz gates, repositories, and routes
 * that build on it inherit a verified contract.
 *
 * @module domains/skills/crud/grants.test
 */

import { describe, expect, it } from "bun:test";
import type { SkillGrant } from "../../../shared/types/index";
import {
  deriveGrantsFromLegacy,
  effectiveGrants,
  legacyListsFromGrants,
  levelAllowsWrite,
  normalizeGrants,
} from "./grants";

describe("effectiveGrants", () => {
  it("returns the explicit grants array when present", () => {
    const grants: SkillGrant[] = [{ type: "user", id: "u1", level: "read_write" }];
    expect(effectiveGrants({ grants })).toBe(grants);
  });

  it("returns the explicit grants even when it is empty (an explicit no-grants state)", () => {
    expect(effectiveGrants({ grants: [], sharedWithUsers: ["u1"] })).toEqual([]);
  });

  it("falls back to READ grants derived from legacy lists when grants is absent", () => {
    expect(
      effectiveGrants({ sharedWithUsers: ["u1"], sharedWithOrgs: ["o1"] }),
    ).toEqual([
      { type: "user", id: "u1", level: "read" },
      { type: "org", id: "o1", level: "read" },
    ]);
  });

  it("treats a fully-absent source as no grants", () => {
    expect(effectiveGrants({})).toEqual([]);
  });
});

describe("deriveGrantsFromLegacy", () => {
  it("maps users + orgs to READ grants, never read_write", () => {
    const out = deriveGrantsFromLegacy(["u1", "u2"], ["o1"]);
    expect(out).toEqual([
      { type: "user", id: "u1", level: "read" },
      { type: "user", id: "u2", level: "read" },
      { type: "org", id: "o1", level: "read" },
    ]);
    expect(out.every((g) => g.level === "read")).toBe(true);
  });

  it("dedupes and drops blank ids", () => {
    expect(deriveGrantsFromLegacy(["u1", "u1", " ", ""], [])).toEqual([
      { type: "user", id: "u1", level: "read" },
    ]);
  });
});

describe("legacyListsFromGrants (dual-write projection)", () => {
  it("places every grant id in its legacy list regardless of level (read visibility, no escalation)", () => {
    const grants: SkillGrant[] = [
      { type: "user", id: "u1", level: "read" },
      { type: "user", id: "u2", level: "read_write" },
      { type: "org", id: "o1", level: "read_write" },
    ];
    expect(legacyListsFromGrants(grants)).toEqual({
      sharedWithUsers: ["u1", "u2"],
      sharedWithOrgs: ["o1"],
    });
  });

  it("round-trips legacy → grants → legacy losslessly for read-only data", () => {
    const lists = { sharedWithUsers: ["u1", "u2"], sharedWithOrgs: ["o1"] };
    const grants = deriveGrantsFromLegacy(lists.sharedWithUsers, lists.sharedWithOrgs);
    expect(legacyListsFromGrants(grants)).toEqual(lists);
  });
});

describe("normalizeGrants", () => {
  it("collapses duplicate (type,id) keeping the highest level (read_write wins)", () => {
    expect(
      normalizeGrants([
        { type: "user", id: "u1", level: "read" },
        { type: "user", id: "u1", level: "read_write" },
      ]),
    ).toEqual([{ type: "user", id: "u1", level: "read_write" }]);
  });

  it("does not let a later read downgrade an earlier read_write", () => {
    expect(
      normalizeGrants([
        { type: "org", id: "o1", level: "read_write" },
        { type: "org", id: "o1", level: "read" },
      ]),
    ).toEqual([{ type: "org", id: "o1", level: "read_write" }]);
  });

  it("trims ids and drops empties, preserving first-appearance order", () => {
    expect(
      normalizeGrants([
        { type: "user", id: " u2 ", level: "read" },
        { type: "user", id: "", level: "read_write" },
        { type: "user", id: "u1", level: "read" },
      ]),
    ).toEqual([
      { type: "user", id: "u2", level: "read" },
      { type: "user", id: "u1", level: "read" },
    ]);
  });

  it("keeps user and org of the same id distinct", () => {
    expect(
      normalizeGrants([
        { type: "user", id: "x", level: "read" },
        { type: "org", id: "x", level: "read_write" },
      ]),
    ).toEqual([
      { type: "user", id: "x", level: "read" },
      { type: "org", id: "x", level: "read_write" },
    ]);
  });
});

describe("levelAllowsWrite", () => {
  it("only read_write permits writing", () => {
    expect(levelAllowsWrite("read_write")).toBe(true);
    expect(levelAllowsWrite("read")).toBe(false);
  });
});
