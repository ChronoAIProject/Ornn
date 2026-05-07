/**
 * UT-SCHEMA-* — per-section Zod validation tests.
 *
 * @module domains/settings/sections/sections.test
 */

import { describe, expect, it } from "bun:test";
import {
  extrasSection,
  mirrorSection,
  nyxidSection,
  playgroundSection,
  quotaDefaultsSection,
  servicesSection,
  skillAuditSection,
  skillGenSection,
  telemetrySection,
} from "./index";

describe("section schemas", () => {
  // -------- playground --------
  it("UT-SCHEMA-PG-001/002: playground bounds", () => {
    const ok = playgroundSection.schema.safeParse({
      defaultProviderId: "p",
      defaultModelId: "m",
      sseKeepAliveMs: 15_000,
    });
    expect(ok.success).toBe(true);
    expect(
      playgroundSection.schema.safeParse({
        defaultProviderId: "p",
        defaultModelId: "m",
        sseKeepAliveMs: 999,
      }).success,
    ).toBe(false);
    expect(
      playgroundSection.schema.safeParse({
        defaultProviderId: "p",
        defaultModelId: "m",
        sseKeepAliveMs: 600_001,
      }).success,
    ).toBe(false);
  });

  // -------- skillGen --------
  it("UT-SCHEMA-SG-001/002: skillGen bounds", () => {
    expect(
      skillGenSection.schema.safeParse({
        defaultProviderId: null,
        defaultModelId: null,
        sseKeepAliveMs: 1000,
      }).success,
    ).toBe(true);
    expect(
      skillGenSection.schema.safeParse({
        defaultProviderId: null,
        defaultModelId: null,
        sseKeepAliveMs: 500,
      }).success,
    ).toBe(false);
  });

  // -------- quota defaults --------
  it("UT-SCHEMA-Q-001/002: quotaDefaults bounds", () => {
    expect(
      quotaDefaultsSection.schema.safeParse({
        defaultPlaygroundMonthly: 0,
        defaultSkillGenMonthly: 1_000_000,
      }).success,
    ).toBe(true);
    expect(
      quotaDefaultsSection.schema.safeParse({
        defaultPlaygroundMonthly: -1,
        defaultSkillGenMonthly: 0,
      }).success,
    ).toBe(false);
    expect(
      quotaDefaultsSection.schema.safeParse({
        defaultPlaygroundMonthly: 1_000_001,
        defaultSkillGenMonthly: 0,
      }).success,
    ).toBe(false);
    expect(
      quotaDefaultsSection.schema.safeParse({
        defaultPlaygroundMonthly: 1.5,
        defaultSkillGenMonthly: 0,
      }).success,
    ).toBe(false);
  });

  // -------- nyxid --------
  it("UT-SCHEMA-NYX-001: tokenUrl must be http(s) or empty", () => {
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        tokenUrl: "https://nyx.example.com/oauth/token",
      }).success,
    ).toBe(true);
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        tokenUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-NYX-002: baseApiUrl must be http(s) when set (#275)", () => {
    const ok = nyxidSection.schema.safeParse({
      ...nyxidSection.defaults,
      baseApiUrl: "https://nyx-api.example.com",
    });
    expect(ok.success).toBe(true);
    const bad = nyxidSection.schema.safeParse({
      ...nyxidSection.defaults,
      baseApiUrl: "ftp://nyx-api.example.com",
    });
    expect(bad.success).toBe(false);
  });

  // -------- services --------
  it("UT-SCHEMA-SVC-001: bucket regex no-slash", () => {
    expect(
      servicesSection.schema.safeParse({
        chronoStorageUrl: "",
        chronoStorageBucket: "ornn-prod",
        chronoSandboxUrl: "",
      }).success,
    ).toBe(true);
    expect(
      servicesSection.schema.safeParse({
        chronoStorageUrl: "",
        chronoStorageBucket: "bad/slash",
        chronoSandboxUrl: "",
      }).success,
    ).toBe(false);
    expect(
      servicesSection.schema.safeParse({
        chronoStorageUrl: "",
        // 64-char bucket exceeds limit
        chronoStorageBucket: "a".repeat(64),
        chronoSandboxUrl: "",
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-SVC-002: storage url validates http(s)", () => {
    // S2 rejects mDNS `.local` for SSRF safety; use a public-looking host.
    expect(
      servicesSection.schema.safeParse({
        chronoStorageUrl: "https://storage.example.com",
        chronoStorageBucket: "ornn",
        chronoSandboxUrl: "https://sandbox.example.com",
      }).success,
    ).toBe(true);
    expect(
      servicesSection.schema.safeParse({
        chronoStorageUrl: "ftp://nope",
        chronoStorageBucket: "ornn",
        chronoSandboxUrl: "",
      }).success,
    ).toBe(false);
  });

  // -------- skillAudit --------
  it("UT-SCHEMA-AUDIT-001: riskThreshold 0..10", () => {
    expect(
      skillAuditSection.schema.safeParse({
        ...skillAuditSection.defaults,
        riskThreshold: 0,
      }).success,
    ).toBe(true);
    expect(
      skillAuditSection.schema.safeParse({
        ...skillAuditSection.defaults,
        riskThreshold: 10,
      }).success,
    ).toBe(true);
    expect(
      skillAuditSection.schema.safeParse({
        ...skillAuditSection.defaults,
        riskThreshold: -0.1,
      }).success,
    ).toBe(false);
    expect(
      skillAuditSection.schema.safeParse({
        ...skillAuditSection.defaults,
        riskThreshold: 10.1,
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-AUDIT-002: agentSealTimeoutMs bounds", () => {
    expect(
      skillAuditSection.schema.safeParse({
        ...skillAuditSection.defaults,
        agentSealTimeoutMs: 999,
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-AUDIT-003: llmAuditDefaultProviderId required when llmAuditEnabled", () => {
    const missing = skillAuditSection.schema.safeParse({
      ...skillAuditSection.defaults,
      llmAuditEnabled: true,
      llmAuditDefaultProviderId: null,
    });
    expect(missing.success).toBe(false);
    const ok = skillAuditSection.schema.safeParse({
      ...skillAuditSection.defaults,
      llmAuditEnabled: true,
      llmAuditDefaultProviderId: "openai",
    });
    expect(ok.success).toBe(true);
  });

  // -------- extras --------
  it("UT-SCHEMA-EXTRAS-001: service name regex (#284 — case-insensitive + dot/underscore)", () => {
    // Mixed-case + dash + underscore + dot all permitted (covers
    // canonical names: NyxID, twitter-api, openai_v2, v1.beta).
    for (const name of ["valid-svc1", "NyxID", "openai_v2", "v1.beta"]) {
      expect(
        extrasSection.schema.safeParse({
          extraNyxidServices: [{ name, baseUrl: "" }],
        }).success,
      ).toBe(true);
    }
    // Spaces still rejected — value flows into URL path segments.
    expect(
      extrasSection.schema.safeParse({
        extraNyxidServices: [{ name: "has space", baseUrl: "" }],
      }).success,
    ).toBe(false);
    // Empty + over-length still rejected.
    expect(
      extrasSection.schema.safeParse({
        extraNyxidServices: [{ name: "", baseUrl: "" }],
      }).success,
    ).toBe(false);
    expect(
      extrasSection.schema.safeParse({
        extraNyxidServices: [{ name: "a".repeat(65), baseUrl: "" }],
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-EXTRAS-002: duplicate names rejected", () => {
    const dup = extrasSection.schema.safeParse({
      extraNyxidServices: [
        { name: "svc-a", baseUrl: "" },
        { name: "svc-a", baseUrl: "" },
      ],
    });
    expect(dup.success).toBe(false);
  });

  // -------- mirror --------
  it("UT-SCHEMA-MIRROR-001: mirror schema validates basic shape", () => {
    expect(
      mirrorSection.schema.safeParse({
        enabled: true,
        owner: "ChronoAIProject",
        repo: "ornn-skills",
        branch: "main",
        appId: "12345",
        installationId: "67890",
        appPrivateKey: "-----BEGIN PRIVATE KEY-----\n...\n",
      }).success,
    ).toBe(true);
    expect(
      mirrorSection.schema.safeParse({
        enabled: "yes" as unknown as boolean,
        owner: "",
        repo: "",
        branch: "",
        appId: "",
        installationId: "",
        appPrivateKey: "",
      }).success,
    ).toBe(false);
  });

  // -------- telemetry --------
  it("telemetry schema accepts placeholder defaults", () => {
    expect(
      telemetrySection.schema.safeParse(telemetrySection.defaults).success,
    ).toBe(true);
  });

  // -------- S2: SSRF guard on URL fields --------
  it("S2: nyxid rejects loopback / metadata / RFC1918 URLs", () => {
    const tries = [
      "http://127.0.0.1:6379/",
      "http://localhost:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
      "http://[::1]/",
    ];
    for (const url of tries) {
      const r = nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        tokenUrl: url,
      });
      expect(r.success).toBe(false);
    }
  });

  it("S2: services rejects loopback chronoStorageUrl/chronoSandboxUrl", () => {
    const r = servicesSection.schema.safeParse({
      chronoStorageUrl: "http://127.0.0.1:9000/",
      chronoStorageBucket: "ornn",
      chronoSandboxUrl: "http://10.0.0.1/",
    });
    expect(r.success).toBe(false);
  });

  it("S2: extras rejects loopback service baseUrl", () => {
    const r = extrasSection.schema.safeParse({
      extraNyxidServices: [{ name: "internal", baseUrl: "http://localhost/" }],
    });
    expect(r.success).toBe(false);
  });
});
