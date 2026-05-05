import { describe, test, expect } from "bun:test";
import { isSensitiveHeader, resolveSourceIp, truncateIp } from "./headers";

describe("audit headers — isSensitiveHeader", () => {
  test("strips Authorization (case-insensitive)", () => {
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("authorization")).toBe(true);
    expect(isSensitiveHeader("AUTHORIZATION")).toBe(true);
  });

  test("strips Cookie / Set-Cookie", () => {
    expect(isSensitiveHeader("cookie")).toBe(true);
    expect(isSensitiveHeader("Cookie")).toBe(true);
    expect(isSensitiveHeader("set-cookie")).toBe(true);
    expect(isSensitiveHeader("Set-Cookie")).toBe(true);
  });

  test("strips every X-NyxID-* header", () => {
    expect(isSensitiveHeader("X-NyxID-Identity-Token")).toBe(true);
    expect(isSensitiveHeader("x-nyxid-user-id")).toBe(true);
    expect(isSensitiveHeader("X-NyxID-User-Email")).toBe(true);
    expect(isSensitiveHeader("X-NyxID-anything-new")).toBe(true);
  });

  test("does not strip unrelated headers", () => {
    expect(isSensitiveHeader("User-Agent")).toBe(false);
    expect(isSensitiveHeader("X-Request-ID")).toBe(false);
    expect(isSensitiveHeader("Content-Type")).toBe(false);
    expect(isSensitiveHeader("X-Ornn-Caller")).toBe(false);
  });
});

describe("audit headers — truncateIp (IPv4)", () => {
  test("zeros the last octet", () => {
    expect(truncateIp("203.0.113.45")).toBe("203.0.113.0");
    expect(truncateIp("10.20.30.40")).toBe("10.20.30.0");
  });

  test("rejects out-of-range octets as empty", () => {
    expect(truncateIp("999.0.0.1")).toBe("");
  });

  test("trims surrounding whitespace", () => {
    expect(truncateIp("  192.168.1.7  ")).toBe("192.168.1.0");
  });

  test("empty / null input returns empty string", () => {
    expect(truncateIp(null)).toBe("");
    expect(truncateIp(undefined)).toBe("");
    expect(truncateIp("")).toBe("");
    expect(truncateIp("   ")).toBe("");
  });
});

describe("audit headers — truncateIp (IPv6)", () => {
  test("keeps first 48 bits, zeros remainder", () => {
    // 2001:db8:abcd:0011:2233:4455:6677:8899 → /48 → 2001:db8:abcd::
    expect(truncateIp("2001:db8:abcd:0011:2233:4455:6677:8899")).toBe(
      "2001:db8:abcd::",
    );
  });

  test("compressed IPv6 expanded then truncated", () => {
    expect(truncateIp("2001:db8::1")).toBe("2001:db8:0::");
  });

  test("loopback ::1 truncates to 0:0:0::", () => {
    expect(truncateIp("::1")).toBe("0:0:0::");
  });

  test("IPv4-mapped IPv6 unwraps and zeros last octet", () => {
    expect(truncateIp("::ffff:203.0.113.45")).toBe("203.0.113.0");
  });

  test("strips bracket notation", () => {
    expect(truncateIp("[2001:db8::1]")).toBe("2001:db8:0::");
  });
});

describe("audit headers — resolveSourceIp", () => {
  test("prefers X-Forwarded-For first entry", () => {
    expect(
      resolveSourceIp({
        forwardedFor: "203.0.113.45, 10.0.0.1",
        realIp: "10.0.0.99",
        remoteAddr: null,
      }),
    ).toBe("203.0.113.0");
  });

  test("falls back to X-Real-IP when XFF missing", () => {
    expect(
      resolveSourceIp({
        forwardedFor: null,
        realIp: "198.51.100.42",
        remoteAddr: null,
      }),
    ).toBe("198.51.100.0");
  });

  test("falls back to remoteAddr when both XFF + X-Real-IP missing", () => {
    expect(
      resolveSourceIp({
        forwardedFor: null,
        realIp: null,
        remoteAddr: "192.0.2.7",
      }),
    ).toBe("192.0.2.0");
  });

  test("returns empty string when nothing is available", () => {
    expect(
      resolveSourceIp({ forwardedFor: null, realIp: null, remoteAddr: null }),
    ).toBe("");
  });
});
