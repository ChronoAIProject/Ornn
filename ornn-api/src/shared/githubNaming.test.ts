/**
 * Unit tests for shared GitHub naming validation.
 *
 * @module shared/githubNaming.test
 */

import { describe, expect, it } from "bun:test";
import { OWNER_RE, REPO_RE, hasUnsafeSegment } from "./githubNaming";

describe("OWNER_RE", () => {
  it("accepts a plain owner", () => {
    expect(OWNER_RE.test("owner")).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(OWNER_RE.test("")).toBe(false);
  });

  it("rejects a leading-hyphen owner", () => {
    expect(OWNER_RE.test("-owner")).toBe(false);
  });
});

describe("REPO_RE", () => {
  it("accepts repo.name with a dot", () => {
    expect(REPO_RE.test("repo.name")).toBe(true);
  });

  it("accepts repo-1 with a dash", () => {
    expect(REPO_RE.test("repo-1")).toBe(true);
  });

  it("rejects a value containing a slash", () => {
    expect(REPO_RE.test("a/b")).toBe(false);
  });

  it("rejects a value over 100 chars", () => {
    expect(REPO_RE.test("a".repeat(101))).toBe(false);
  });
});

describe("hasUnsafeSegment", () => {
  it("flags a trailing .. segment", () => {
    expect(hasUnsafeSegment("owner/..")).toBe(true);
  });

  it("flags a leading .. segment", () => {
    expect(hasUnsafeSegment("../repo")).toBe(true);
  });

  it("flags a dot-prefixed (hidden) segment", () => {
    expect(hasUnsafeSegment(".hidden")).toBe(true);
  });

  it("flags a dot-suffixed (trailing-dot) segment", () => {
    expect(hasUnsafeSegment("trail.")).toBe(true);
  });

  it("allows a normal owner/repo.name identifier", () => {
    expect(hasUnsafeSegment("owner/repo.name")).toBe(false);
  });
});
