import { describe, expect, test } from "vitest";
import { formatVersionLabel } from "./versionLabel";

describe("formatVersionLabel", () => {
  test("bare version when no flags", () => {
    expect(formatVersionLabel("1.2")).toBe("1.2");
  });

  test("marks latest", () => {
    expect(formatVersionLabel("1.2", { isLatest: true })).toBe("1.2 · latest");
  });

  test("marks deprecated", () => {
    expect(formatVersionLabel("1.0", { isDeprecated: true })).toBe("1.0 · deprecated");
  });

  test("marks both when both flags set", () => {
    expect(formatVersionLabel("1.1", { isLatest: true, isDeprecated: true })).toBe(
      "1.1 · latest · deprecated",
    );
  });

  test("respects localized label overrides", () => {
    expect(
      formatVersionLabel("2.0", {
        isLatest: true,
        isDeprecated: true,
        latestText: "最新",
        deprecatedText: "已弃用",
      }),
    ).toBe("2.0 · 最新 · 已弃用");
  });
});
