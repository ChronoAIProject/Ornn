import { describe, expect, test } from "bun:test";
import { AppError } from "../../../shared/types/index";
import { parseVersion, compareVersions, isGreater } from "./version";

describe("parseVersion", () => {
  test("parses major.minor with single digits", () => {
    expect(parseVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseVersion("0.1")).toEqual({ major: 0, minor: 1 });
  });

  test("parses multi-digit major/minor", () => {
    expect(parseVersion("12.34")).toEqual({ major: 12, minor: 34 });
    expect(parseVersion("100.200")).toEqual({ major: 100, minor: 200 });
  });

  test("parses 0.0 as a valid edge case", () => {
    expect(parseVersion("0.0")).toEqual({ major: 0, minor: 0 });
  });

  test("rejects empty string", () => {
    expect(() => parseVersion("")).toThrow(AppError);
  });

  test("rejects missing minor", () => {
    expect(() => parseVersion("1")).toThrow(AppError);
  });

  test("rejects 3-digit semver", () => {
    expect(() => parseVersion("1.0.0")).toThrow(AppError);
  });

  test("rejects leading zeroes", () => {
    expect(() => parseVersion("01.0")).toThrow(AppError);
    expect(() => parseVersion("1.00")).toThrow(AppError);
  });

  test("rejects negative numbers", () => {
    expect(() => parseVersion("-1.0")).toThrow(AppError);
    expect(() => parseVersion("1.-1")).toThrow(AppError);
  });

  test("rejects non-numeric parts", () => {
    expect(() => parseVersion("a.b")).toThrow(AppError);
    expect(() => parseVersion("1.a")).toThrow(AppError);
  });

  test("rejects whitespace", () => {
    expect(() => parseVersion(" 1.0")).toThrow(AppError);
    expect(() => parseVersion("1.0 ")).toThrow(AppError);
  });

  test("thrown AppError is 400 with INVALID_VERSION code", () => {
    try {
      parseVersion("bad");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe("INVALID_VERSION");
    }
  });
});

describe("compareVersions", () => {
  test("returns 0 for equal versions", () => {
    expect(compareVersions({ major: 1, minor: 2 }, { major: 1, minor: 2 })).toBe(0);
  });

  test("major takes precedence over minor", () => {
    expect(compareVersions({ major: 2, minor: 0 }, { major: 1, minor: 99 })).toBe(1);
    expect(compareVersions({ major: 1, minor: 99 }, { major: 2, minor: 0 })).toBe(-1);
  });

  test("compares minor when major equal", () => {
    expect(compareVersions({ major: 1, minor: 3 }, { major: 1, minor: 2 })).toBe(1);
    expect(compareVersions({ major: 1, minor: 2 }, { major: 1, minor: 3 })).toBe(-1);
  });
});

describe("isGreater", () => {
  test("true when strictly greater", () => {
    expect(isGreater({ major: 1, minor: 1 }, { major: 1, minor: 0 })).toBe(true);
    expect(isGreater({ major: 2, minor: 0 }, { major: 1, minor: 99 })).toBe(true);
  });

  test("false when equal", () => {
    expect(isGreater({ major: 1, minor: 0 }, { major: 1, minor: 0 })).toBe(false);
  });

  test("false when smaller", () => {
    expect(isGreater({ major: 1, minor: 0 }, { major: 1, minor: 1 })).toBe(false);
    expect(isGreater({ major: 1, minor: 99 }, { major: 2, minor: 0 })).toBe(false);
  });
});
