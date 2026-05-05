import { describe, test, expect } from "bun:test";
import { resolveCallerType } from "./callerType";

describe("audit callerType — four auth shapes", () => {
  // Shape 1: browser session, X-Ornn-Caller: web → web, no mismatch
  test("browser session with X-Ornn-Caller=web → web, no mismatch", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: false },
      "web",
    );
    expect(result.callerType).toBe("web");
    expect(result.headerHint).toBe("web");
    expect(result.callerTypeMismatch).toBe(false);
  });

  // Shape 2: browser session, header missing or other → web, mismatch
  test("browser session with missing X-Ornn-Caller → web, mismatch", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: false },
      null,
    );
    expect(result.callerType).toBe("web");
    expect(result.headerHint).toBeNull();
    expect(result.callerTypeMismatch).toBe(true);
  });

  test("browser session with bogus X-Ornn-Caller → web, mismatch", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: false },
      "agent",
    );
    expect(result.callerType).toBe("web");
    expect(result.headerHint).toBe("agent");
    expect(result.callerTypeMismatch).toBe(true);
  });

  // Shape 3: NyxID forwarded access token (agent flow). header non-empty
  // disagreeing with "agent" → mismatch.
  test("forwarded user token, no header → agent, no mismatch", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: true },
      null,
    );
    expect(result.callerType).toBe("agent");
    expect(result.callerTypeMismatch).toBe(false);
  });

  test("forwarded user token, header=web → agent, mismatch (frontend bug or replay)", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: true },
      "web",
    );
    expect(result.callerType).toBe("agent");
    expect(result.headerHint).toBe("web");
    expect(result.callerTypeMismatch).toBe(true);
  });

  test("forwarded user token, header=agent → agent, no mismatch", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: true },
      "agent",
    );
    expect(result.callerType).toBe("agent");
    expect(result.callerTypeMismatch).toBe(false);
  });

  // Shape 4: no identity → anonymous, never mismatches
  test("no auth → anonymous, never mismatches regardless of header", () => {
    expect(
      resolveCallerType(
        { hasAuth: false, hasForwardedUserToken: false },
        null,
      ).callerType,
    ).toBe("anonymous");
    expect(
      resolveCallerType(
        { hasAuth: false, hasForwardedUserToken: false },
        "web",
      ).callerTypeMismatch,
    ).toBe(false);
    expect(
      resolveCallerType(
        { hasAuth: false, hasForwardedUserToken: false },
        "agent",
      ).callerTypeMismatch,
    ).toBe(false);
  });
});

describe("audit callerType — header normalization", () => {
  test("empty / whitespace header collapses to null", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: false },
      "   ",
    );
    expect(result.headerHint).toBeNull();
  });

  test("uppercase header lowered", () => {
    const result = resolveCallerType(
      { hasAuth: true, hasForwardedUserToken: false },
      "WEB",
    );
    expect(result.headerHint).toBe("web");
    expect(result.callerTypeMismatch).toBe(false);
  });
});
