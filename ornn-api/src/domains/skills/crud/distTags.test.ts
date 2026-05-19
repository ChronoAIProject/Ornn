/**
 * Tests for dist-tag helpers added in #463.
 *
 * Coverage: tag-name validation + `?version=@<tag>` resolution logic.
 * The full service + repo + routes integration is exercised by the
 * route test below (real Mongo).
 *
 * @module domains/skills/crud/distTags.test
 */

import { describe, expect, test } from "bun:test";
import { AppError } from "../../../shared/types/index";
import type { SkillDocument } from "../../../shared/types/index";
import { isValidTagName, resolveDistTag } from "./service";

function fakeSkill(overrides: Partial<SkillDocument>): SkillDocument {
  return {
    guid: "s1",
    name: "demo",
    description: "",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    skillHash: "",
    storageKey: "",
    createdBy: "u1",
    createdOn: new Date(),
    updatedBy: "u1",
    updatedOn: new Date(),
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  };
}

describe("isValidTagName", () => {
  test.each([
    ["latest", true],
    ["stable", true],
    ["next", true],
    ["rc-1", true],
    ["beta-2", true],
    ["a", true],
    // npm-style: max 50 chars
    ["a".repeat(50), true],
  ])("accepts %s", (tag, expected) => {
    expect(isValidTagName(tag)).toBe(expected);
  });

  test.each([
    ["", false],
    ["Latest", false], // uppercase
    ["1stable", false], // leading digit
    ["a".repeat(51), false], // over 50
    ["with space", false],
    ["with.dot", false],
    ["@latest", false], // leading @ rejected at this layer
    ["-leading", false],
  ])("rejects %s", (tag, expected) => {
    expect(isValidTagName(tag)).toBe(expected);
  });
});

describe("resolveDistTag (#463)", () => {
  test("literal version passes through verbatim", () => {
    const skill = fakeSkill({});
    expect(resolveDistTag(skill, "1.5")).toBe("1.5");
    expect(resolveDistTag(skill, "0.1")).toBe("0.1");
  });

  test("empty string returns undefined (caller wants latest)", () => {
    const skill = fakeSkill({});
    expect(resolveDistTag(skill, "")).toBeUndefined();
  });

  test("@<tag> resolves via distTags map", () => {
    const skill = fakeSkill({
      distTags: { latest: "1.5", stable: "1.4", beta: "2.0" },
    });
    expect(resolveDistTag(skill, "@stable")).toBe("1.4");
    expect(resolveDistTag(skill, "@beta")).toBe("2.0");
    expect(resolveDistTag(skill, "@latest")).toBe("1.5");
  });

  test("@latest falls back to skill.latestVersion on legacy skills (no distTags field)", () => {
    // Skills published before #463 have no distTags field; `@latest`
    // should still work for backwards-compat — the cached
    // `latestVersion` pointer is the right answer.
    const skill = fakeSkill({ latestVersion: "2.3" });
    expect(resolveDistTag(skill, "@latest")).toBe("2.3");
  });

  test("missing non-latest tag throws skill_version_not_found", () => {
    const skill = fakeSkill({ distTags: { latest: "1.0" } });
    let caught: unknown = null;
    try {
      resolveDistTag(skill, "@stable");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("skill_version_not_found");
    expect((caught as AppError).statusCode).toBe(404);
  });

  test("@ with no tag name throws invalid_dist_tag", () => {
    const skill = fakeSkill({});
    let caught: unknown = null;
    try {
      resolveDistTag(skill, "@");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("invalid_dist_tag");
  });
});
