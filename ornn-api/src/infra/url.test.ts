/**
 * Unit tests for `infra/url` — SSRF guard + allowlist bypass.
 *
 * @module infra/url.test
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  isPrivateHost,
  requirePublicUrl,
  validatePublicUrl,
} from "./url";

const ENV = "ORNN_URL_ALLOWLIST_CIDR";
const original = process.env[ENV];

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV];
  } else {
    process.env[ENV] = original;
  }
});

describe("isPrivateHost", () => {
  it("rejects loopback aliases", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("Localhost")).toBe(true);
    expect(isPrivateHost("anything.localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("127.255.255.254")).toBe(true);
  });

  it("rejects RFC1918 ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("10.255.255.255")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("172.15.0.1")).toBe(false); // outside 172.16/12
    expect(isPrivateHost("172.32.0.1")).toBe(false); // outside 172.16/12
    expect(isPrivateHost("192.168.0.1")).toBe(true);
    expect(isPrivateHost("192.168.255.255")).toBe(true);
  });

  it("rejects link-local (AWS/GCP metadata)", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("169.254.0.0")).toBe(true);
  });

  it("rejects IPv6 loopback + ULA + link-local", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("::")).toBe(true);
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fdff::1")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 forms of private addresses", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:169.254.169.254")).toBe(true);
  });

  it("accepts public hosts + public IPv4", () => {
    expect(isPrivateHost("ornn.chrono-ai.fun")).toBe(false);
    expect(isPrivateHost("api.openai.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("1.1.1.1")).toBe(false);
  });

  it("rejects dotted-decimal evasion at parse time (out-of-range octets)", () => {
    // "256.x.y.z" is not a valid IPv4 dotted-quad — host is treated
    // as a hostname. Hostname won't match `.localhost` / `.local`, so
    // the safe answer is "not private". The schema's URL parser will
    // still surface the malformed-host issue separately.
    expect(isPrivateHost("256.0.0.1")).toBe(false);
  });
});

describe("validatePublicUrl", () => {
  it("accepts empty string ('not configured')", () => {
    expect(validatePublicUrl("").ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validatePublicUrl("ftp://example.com").ok).toBe(false);
    expect(validatePublicUrl("javascript:alert(1)").ok).toBe(false);
    expect(validatePublicUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validatePublicUrl("not a url").ok).toBe(false);
    expect(validatePublicUrl("https://").ok).toBe(false);
  });

  it("rejects loopback / RFC1918 / metadata", () => {
    expect(validatePublicUrl("http://127.0.0.1:6379/").ok).toBe(false);
    expect(validatePublicUrl("http://localhost:8080/").ok).toBe(false);
    expect(validatePublicUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(validatePublicUrl("http://10.0.0.1/").ok).toBe(false);
  });

  it("rejects IPv6 loopback in bracket form", () => {
    expect(validatePublicUrl("http://[::1]/").ok).toBe(false);
    expect(validatePublicUrl("http://[fe80::1]/").ok).toBe(false);
    expect(validatePublicUrl("http://[::ffff:127.0.0.1]/").ok).toBe(false);
  });

  it("accepts ordinary public URLs", () => {
    expect(validatePublicUrl("https://api.openai.com").ok).toBe(true);
    expect(validatePublicUrl("https://nyx.chrono-ai.fun/oauth/token").ok).toBe(true);
  });

  it("allowlist bypass — bare hostname", () => {
    process.env[ENV] = "internal-llm.svc";
    expect(validatePublicUrl("http://internal-llm.svc:8080/").ok).toBe(true);
    expect(validatePublicUrl("http://other.svc:8080/").ok).toBe(true); // public host, ok anyway
    expect(validatePublicUrl("http://127.0.0.1/").ok).toBe(false); // not in allowlist
  });

  it("allowlist bypass — IPv4 CIDR", () => {
    process.env[ENV] = "10.42.0.0/16";
    expect(validatePublicUrl("http://10.42.0.7:8080/").ok).toBe(true);
    expect(validatePublicUrl("http://10.42.255.255/").ok).toBe(true);
    expect(validatePublicUrl("http://10.43.0.1/").ok).toBe(false); // outside CIDR
  });

  it("allowlist bypass — single-IP entry", () => {
    process.env[ENV] = "10.0.0.7";
    expect(validatePublicUrl("http://10.0.0.7/").ok).toBe(true);
    expect(validatePublicUrl("http://10.0.0.8/").ok).toBe(false);
  });

  it("requirePublicUrl is the boolean facade", () => {
    expect(requirePublicUrl("")).toBe(true);
    expect(requirePublicUrl("https://api.openai.com")).toBe(true);
    expect(requirePublicUrl("http://127.0.0.1/")).toBe(false);
  });
});
