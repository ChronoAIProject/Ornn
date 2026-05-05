import { describe, test, expect } from "bun:test";
import { buildBlacklistRegex, redactBody } from "./redaction";

describe("audit redaction — buildBlacklistRegex", () => {
  test("default regex matches the documented field names case-insensitively", () => {
    const re = buildBlacklistRegex();
    expect(re.test("password")).toBe(true);
    expect(re.test("Password")).toBe(true);
    expect(re.test("PASSWORD")).toBe(true);
    expect(re.test("token")).toBe(true);
    expect(re.test("apiKey")).toBe(true);
    expect(re.test("api_key")).toBe(true); // contains "key"
    expect(re.test("secret")).toBe(true);
    expect(re.test("credential")).toBe(true);
    expect(re.test("nyxid_credentials")).toBe(true);
  });

  test("default regex does not match unrelated names", () => {
    const re = buildBlacklistRegex();
    expect(re.test("name")).toBe(false);
    expect(re.test("description")).toBe(false);
    expect(re.test("skillId")).toBe(false);
    expect(re.test("category")).toBe(false);
  });

  test("extra patterns are ORed in, do not displace defaults", () => {
    const re = buildBlacklistRegex(["session", "cookie"]);
    expect(re.test("password")).toBe(true);
    expect(re.test("session")).toBe(true);
    expect(re.test("Cookie")).toBe(true);
  });
});

describe("audit redaction — redactBody whitelist + blacklist semantics", () => {
  const blacklist = buildBlacklistRegex();

  test("flat object: whitelisted keys preserved, others redacted", () => {
    const result = redactBody(
      { skillName: "fizz", description: "buzz", random: "x" },
      new Set(["skillName", "description"]),
      blacklist,
    );
    expect(result.value).toEqual({
      skillName: "fizz",
      description: "buzz",
      random: "[REDACTED]",
    });
    expect(result.redactedFields).toEqual(["random"]);
  });

  test("blacklist beats whitelist (apiKey is whitelisted but blocked anyway)", () => {
    const result = redactBody(
      { skillName: "fizz", apiKey: "should-not-leak" },
      new Set(["skillName", "apiKey"]),
      blacklist,
    );
    expect(result.value).toEqual({
      skillName: "fizz",
      apiKey: "[REDACTED]",
    });
    expect(result.redactedFields).toEqual(["apiKey"]);
  });

  test("nested objects: whitelisted leaves deep inside survive blacklist", () => {
    const result = redactBody(
      {
        metadata: {
          tags: ["a", "b"],
          // This nested apiKey must be redacted even though `metadata`
          // is whitelisted as a container.
          apiKey: "leak",
        },
        skillName: "ok",
      },
      new Set(["metadata", "tags", "skillName"]),
      blacklist,
    );
    expect(result.value).toEqual({
      metadata: {
        tags: ["a", "b"],
        apiKey: "[REDACTED]",
      },
      skillName: "ok",
    });
    expect(result.redactedFields).toContain("apiKey");
  });

  test("non-whitelisted nested scalars are redacted", () => {
    const result = redactBody(
      {
        outer: {
          inner: "secretish",
        },
      },
      new Set([]),
      blacklist,
    );
    expect(result.value).toEqual({
      outer: { inner: "[REDACTED]" },
    });
    expect(result.redactedFields).toEqual(["inner"]);
  });

  test("arrays of objects recurse element-wise", () => {
    const result = redactBody(
      {
        items: [
          { name: "x", token: "leak" },
          { name: "y", token: "leak2" },
        ],
      },
      new Set(["items", "name"]),
      blacklist,
    );
    expect(result.value).toEqual({
      items: [
        { name: "x", token: "[REDACTED]" },
        { name: "y", token: "[REDACTED]" },
      ],
    });
    expect(result.redactedFields).toEqual(["token"]);
  });

  test("null / undefined short-circuit", () => {
    expect(redactBody(null, new Set(), blacklist).value).toBeNull();
    expect(redactBody(undefined, new Set(), blacklist).value).toBeUndefined();
  });

  test("primitive root has no key to match — returned untouched", () => {
    expect(redactBody("a string body", new Set(), blacklist).value).toBe(
      "a string body",
    );
    expect(redactBody(42, new Set(), blacklist).value).toBe(42);
  });

  test("redactedFields is sorted and deduped", () => {
    const result = redactBody(
      {
        a: { token: 1 },
        b: { token: 2 },
        c: "x",
      },
      new Set(),
      blacklist,
    );
    // 'token' appears twice on input but once in the redactedFields list.
    expect(result.redactedFields).toEqual(["c", "token"]);
  });
});
