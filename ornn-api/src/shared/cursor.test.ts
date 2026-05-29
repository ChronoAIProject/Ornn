/**
 * Tests for the cursor codec (#457).
 *
 * Pins the encode/decode round-trip + the "last page" semantics so
 * subsequent rewrites (eventual lastSort keyset cursors) can be
 * validated against the same contract.
 *
 * @module shared/cursor.test
 */

import { describe, expect, test } from "bun:test";
import { encodeCursor, decodeCursor, buildNextCursor } from "./cursor";

describe("encodeCursor + decodeCursor round-trip", () => {
  test("encodes + decodes a page payload losslessly", () => {
    const original = { page: 7 };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  test("encoded cursor is URL-safe (no `/` or `+`)", () => {
    // base64url is the standard for opaque tokens in URL params — pin
    // it so future codec rewrites can't silently regress to base64.
    const encoded = encodeCursor({ page: 1 });
    expect(encoded).not.toMatch(/[/+=]/);
  });

  test("decodeCursor returns null on malformed input", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("not-base64!")).toBeNull();
    expect(decodeCursor(Buffer.from("not-json", "utf-8").toString("base64url"))).toBeNull();
    // Missing `page` field
    expect(decodeCursor(Buffer.from('{"x":1}', "utf-8").toString("base64url"))).toBeNull();
    // Non-integer page
    expect(decodeCursor(Buffer.from('{"page":1.5}', "utf-8").toString("base64url"))).toBeNull();
    // Negative page
    expect(decodeCursor(Buffer.from('{"page":-1}', "utf-8").toString("base64url"))).toBeNull();
    // page is 0
    expect(decodeCursor(Buffer.from('{"page":0}', "utf-8").toString("base64url"))).toBeNull();
  });
});

describe("buildNextCursor — last-page semantics", () => {
  test("emits a cursor when the page is full (more items likely)", () => {
    const c = buildNextCursor({ currentPage: 2, pageSize: 9, itemsReturned: 9 });
    expect(c).toBeDefined();
    expect(decodeCursor(c)).toEqual({ page: 3 });
  });

  test("omits the cursor when the page is partial (last page)", () => {
    // Per CONVENTIONS.md §4.3: "When hasMore === false, nextCursor MAY
    // be omitted." This function returns undefined for that case.
    const c = buildNextCursor({ currentPage: 5, pageSize: 9, itemsReturned: 3 });
    expect(c).toBeUndefined();
  });

  test("omits the cursor when the page is empty", () => {
    const c = buildNextCursor({ currentPage: 99, pageSize: 9, itemsReturned: 0 });
    expect(c).toBeUndefined();
  });
});
