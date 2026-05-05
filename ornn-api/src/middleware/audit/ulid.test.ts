import { describe, test, expect } from "bun:test";
import { ulid } from "./ulid";

describe("audit ulid", () => {
  test("returns a 26-char Crockford-base32 string", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)).toBe(true);
  });

  test("monotonically sortable across milliseconds", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  test("two consecutive calls in the same ms produce different ids", () => {
    const t = Date.now();
    const a = ulid(t);
    const b = ulid(t);
    expect(a).not.toBe(b);
  });
});
