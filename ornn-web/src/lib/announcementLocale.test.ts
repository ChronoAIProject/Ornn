/**
 * Tests for the bilingual announcement locale resolver.
 *
 * @module lib/announcementLocale.test
 */

import { describe, it, expect } from "vitest";
import { pickLocalized, pickLocalizedCtaLabel } from "./announcementLocale";

describe("pickLocalized", () => {
  it("returns ZH when lang is zh and zh has content", () => {
    expect(pickLocalized("Hello", "你好", "zh")).toBe("你好");
  });

  it("returns ZH for any zh- BCP-47 variant when zh has content", () => {
    expect(pickLocalized("Hello", "你好", "zh-CN")).toBe("你好");
    expect(pickLocalized("Hello", "你好", "zh-Hant")).toBe("你好");
    expect(pickLocalized("Hello", "你好", "ZH-cn")).toBe("你好");
  });

  it("falls back to EN when zh is empty even if lang is zh", () => {
    expect(pickLocalized("Hello", "", "zh-CN")).toBe("Hello");
    expect(pickLocalized("Hello", "   ", "zh")).toBe("Hello");
  });

  it("returns EN for any non-zh lang", () => {
    expect(pickLocalized("Hello", "你好", "en")).toBe("Hello");
    expect(pickLocalized("Hello", "你好", "en-US")).toBe("Hello");
    expect(pickLocalized("Hello", "你好", "fr")).toBe("Hello");
  });

  it("treats null/undefined lang as EN", () => {
    expect(pickLocalized("Hello", "你好", null)).toBe("Hello");
    expect(pickLocalized("Hello", "你好", undefined)).toBe("Hello");
    expect(pickLocalized("Hello", "你好", "")).toBe("Hello");
  });
});

describe("pickLocalizedCtaLabel", () => {
  it("returns ZH label when set and lang is zh", () => {
    expect(pickLocalizedCtaLabel("See more", "了解更多", "zh-CN")).toBe(
      "了解更多",
    );
  });

  it("falls back to EN label when ZH is null but EN is set", () => {
    expect(pickLocalizedCtaLabel("See more", null, "zh-CN")).toBe("See more");
  });

  it("falls back to EN label when ZH is empty string", () => {
    expect(pickLocalizedCtaLabel("See more", "", "zh-CN")).toBe("See more");
    expect(pickLocalizedCtaLabel("See more", "   ", "zh-CN")).toBe("See more");
  });

  it("returns null when both locales are null (no CTA)", () => {
    expect(pickLocalizedCtaLabel(null, null, "en")).toBeNull();
    expect(pickLocalizedCtaLabel(null, null, "zh")).toBeNull();
  });

  it("returns null when EN is empty/whitespace AND lang isn't zh (or ZH empty)", () => {
    expect(pickLocalizedCtaLabel("", null, "en")).toBeNull();
    expect(pickLocalizedCtaLabel("   ", null, "zh")).toBeNull();
  });
});
