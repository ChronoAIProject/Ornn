import { describe, expect, it } from "vitest";
import { encodeErrorPayload, translateError } from "./translateError";

// `translateError.ts` imports the i18next *instance* (`@/i18n` default
// export), not the react-i18next hook stubbed in `src/test/setup.ts`. Mock
// that instance so `i18n.t` is a deterministic spy: bare key passthrough,
// or `key:params` when interpolation params are present.
vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0
        ? `${key}:${JSON.stringify(params)}`
        : key,
  },
}));

describe("translateError", () => {
  it("translates an encoded JSON payload with its params", () => {
    const msg = encodeErrorPayload({
      key: "errors.api.quota.exceeded",
      params: { limit: 5 },
    });
    expect(translateError(new Error(msg))).toBe(
      `errors.api.quota.exceeded:${JSON.stringify({ limit: 5 })}`,
    );
  });

  it("falls through to raw text for non-payload JSON objects", () => {
    // Valid JSON object but no `key` field → not an ErrorPayload, and the
    // raw text doesn't look like an i18n key → returned verbatim.
    const raw = '{"foo":"bar"}';
    expect(translateError(new Error(raw))).toBe(raw);
  });

  it("returns the raw message when JSON parsing throws", () => {
    // Starts with "{" so the parse path is taken, but it's malformed →
    // catch → fall through → raw passthrough.
    const raw = "{not valid json";
    expect(translateError(new Error(raw))).toBe(raw);
  });

  it("translates a dotted errors.* key on an Error", () => {
    expect(translateError(new Error("errors.generic.unknown"))).toBe(
      "errors.generic.unknown",
    );
  });

  it("passes a plain Error message through unchanged", () => {
    expect(translateError(new Error("Something broke"))).toBe("Something broke");
  });

  it("translates a string errors.* key", () => {
    expect(translateError("errors.api.notFound")).toBe("errors.api.notFound");
  });

  it("passes a plain string through unchanged", () => {
    expect(translateError("just a message")).toBe("just a message");
  });

  it("uses the provided fallback for null / non-Error input", () => {
    expect(translateError(null, "fallback text")).toBe("fallback text");
  });

  it("falls back to errors.generic.unknown when no fallback is given", () => {
    expect(translateError(undefined)).toBe("errors.generic.unknown");
    expect(translateError(42)).toBe("errors.generic.unknown");
  });
});

describe("encodeErrorPayload", () => {
  it("round-trips through translateError", () => {
    const payload = { key: "errors.foo.bar", params: { n: 1 } };
    const encoded = encodeErrorPayload(payload);
    expect(JSON.parse(encoded)).toEqual(payload);
    expect(translateError(new Error(encoded))).toBe(
      `errors.foo.bar:${JSON.stringify({ n: 1 })}`,
    );
  });
});
