/**
 * Zod schema tests for the broadcasts domain (#502 — recipientUserIds).
 *
 * Pinned contract:
 *   - POST: `recipientUserIds` is optional; when present must be a
 *     non-empty `string[]` of non-empty strings. `null` / `[]` / arrays
 *     with empty strings are rejected.
 *   - PATCH: `recipientUserIds` is unknown — `.strict()` rejects with
 *     "Unrecognized key" so a forged PATCH can't change recipients.
 *
 * @module domains/broadcasts/schemas.test
 */

import { describe, expect, test } from "bun:test";
import { createBroadcastSchema, patchBroadcastSchema } from "./schemas";

const baseCreate = {
  titleI18n: { en: "Hello", zh: "你好" },
  bodyMarkdownI18n: { en: "World", zh: "世界" },
};

describe("createBroadcastSchema — recipientUserIds (#502)", () => {
  test("omitted recipientUserIds parses as broadcast-to-all (field is absent)", () => {
    const parsed = createBroadcastSchema.safeParse(baseCreate);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recipientUserIds).toBeUndefined();
    }
  });

  test("non-empty string[] parses as targeted broadcast", () => {
    const parsed = createBroadcastSchema.safeParse({
      ...baseCreate,
      recipientUserIds: ["u-1", "u-2"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recipientUserIds).toEqual(["u-1", "u-2"]);
    }
  });

  test("empty array is rejected (min(1) on the array)", () => {
    const parsed = createBroadcastSchema.safeParse({
      ...baseCreate,
      recipientUserIds: [],
    });
    expect(parsed.success).toBe(false);
  });

  test("null is rejected — frontend must omit the key, not pass null", () => {
    const parsed = createBroadcastSchema.safeParse({
      ...baseCreate,
      recipientUserIds: null,
    });
    expect(parsed.success).toBe(false);
  });

  test("array containing an empty string is rejected (min(1) per id)", () => {
    const parsed = createBroadcastSchema.safeParse({
      ...baseCreate,
      recipientUserIds: ["u-1", ""],
    });
    expect(parsed.success).toBe(false);
  });

  test("non-string entries are rejected", () => {
    const parsed = createBroadcastSchema.safeParse({
      ...baseCreate,
      recipientUserIds: ["u-1", 123],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("patchBroadcastSchema — recipientUserIds is immutable (#502)", () => {
  test("PATCH with recipientUserIds is rejected — .strict() blocks unknown keys", () => {
    const parsed = patchBroadcastSchema.safeParse({
      titleI18n: { en: "edit" },
      recipientUserIds: ["u-1", "u-2"],
    });
    expect(parsed.success).toBe(false);
    // Sanity-check the failure reason so a future change that adds the
    // field on PATCH (and accidentally accepts it) trips this test.
    if (!parsed.success) {
      const hasUnrecognized = parsed.error.issues.some((issue) =>
        issue.code === "unrecognized_keys",
      );
      expect(hasUnrecognized).toBe(true);
    }
  });

  test("PATCH without recipientUserIds still parses normally", () => {
    const parsed = patchBroadcastSchema.safeParse({
      titleI18n: { en: "edit" },
    });
    expect(parsed.success).toBe(true);
  });
});
