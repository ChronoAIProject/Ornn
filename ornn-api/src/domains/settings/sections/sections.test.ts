/**
 * UT-SCHEMA-* — per-section Zod validation tests.
 *
 * @module domains/settings/sections/sections.test
 */

import { describe, expect, it } from "bun:test";
import {
  assistantSection,
  extrasSection,
  mirrorSection,
  nyxidSection,
  playgroundSection,
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
      defaultMonthlyQuota: 200,
    });
    expect(ok.success).toBe(true);
    expect(
      playgroundSection.schema.safeParse({
        defaultProviderId: "p",
        defaultModelId: "m",
        sseKeepAliveMs: 999,
        defaultMonthlyQuota: 200,
      }).success,
    ).toBe(false);
    expect(
      playgroundSection.schema.safeParse({
        defaultProviderId: "p",
        defaultModelId: "m",
        sseKeepAliveMs: 600_001,
        defaultMonthlyQuota: 200,
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-PG-003: playground defaultMonthlyQuota bounds (#302)", () => {
    expect(
      playgroundSection.schema.safeParse({
        ...playgroundSection.defaults,
        defaultMonthlyQuota: 0,
      }).success,
    ).toBe(true);
    expect(
      playgroundSection.schema.safeParse({
        ...playgroundSection.defaults,
        defaultMonthlyQuota: 1_000_000,
      }).success,
    ).toBe(true);
    expect(
      playgroundSection.schema.safeParse({
        ...playgroundSection.defaults,
        defaultMonthlyQuota: -1,
      }).success,
    ).toBe(false);
    expect(
      playgroundSection.schema.safeParse({
        ...playgroundSection.defaults,
        defaultMonthlyQuota: 1_000_001,
      }).success,
    ).toBe(false);
    expect(
      playgroundSection.schema.safeParse({
        ...playgroundSection.defaults,
        defaultMonthlyQuota: 1.5,
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
        defaultMonthlyQuota: 20,
      }).success,
    ).toBe(true);
    expect(
      skillGenSection.schema.safeParse({
        defaultProviderId: null,
        defaultModelId: null,
        sseKeepAliveMs: 500,
        defaultMonthlyQuota: 20,
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-SG-003: skillGen defaultMonthlyQuota bounds (#302)", () => {
    expect(
      skillGenSection.schema.safeParse({
        ...skillGenSection.defaults,
        defaultMonthlyQuota: 1_000_001,
      }).success,
    ).toBe(false);
  });

  // -------- assistant (#970) --------
  it("UT-SCHEMA-ASST-001: assistant defaults are valid + nullable provider/model", () => {
    expect(
      assistantSection.schema.safeParse(assistantSection.defaults).success,
    ).toBe(true);
    expect(assistantSection.defaults.defaultProviderId).toBeNull();
    expect(assistantSection.defaults.defaultModelId).toBeNull();
    expect(assistantSection.id).toBe("assistant");
    expect(assistantSection.publicPath).toBe("assistant");
    expect(assistantSection.secretFields).toEqual([]);
  });

  it("UT-SCHEMA-ASST-002: assistant sseKeepAliveMs bounds", () => {
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        sseKeepAliveMs: 15_000,
      }).success,
    ).toBe(true);
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        sseKeepAliveMs: 999,
      }).success,
    ).toBe(false);
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        sseKeepAliveMs: 600_001,
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-ASST-003: assistant defaultMonthlyQuota bounds", () => {
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        defaultMonthlyQuota: 0,
      }).success,
    ).toBe(true);
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        defaultMonthlyQuota: -1,
      }).success,
    ).toBe(false);
    expect(
      assistantSection.schema.safeParse({
        ...assistantSection.defaults,
        defaultMonthlyQuota: 1_000_001,
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

  it("UT-SCHEMA-NYX-003: chrono-storage bucket regex no-slash (#302, was services)", () => {
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        chronoStorageBucket: "ornn-prod",
      }).success,
    ).toBe(true);
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        chronoStorageBucket: "bad/slash",
      }).success,
    ).toBe(false);
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        chronoStorageBucket: "a".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-NYX-004: chrono-storage/sandbox URLs validate http(s) (#302, was services)", () => {
    // S2 rejects mDNS `.local` for SSRF safety; use a public-looking host.
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        chronoStorageUrl: "https://storage.example.com",
        chronoStorageBucket: "ornn",
        chronoSandboxUrl: "https://sandbox.example.com",
      }).success,
    ).toBe(true);
    expect(
      nyxidSection.schema.safeParse({
        ...nyxidSection.defaults,
        chronoStorageUrl: "ftp://nope",
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
        reconcileSchedule: "0 2 * * *",
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
        reconcileSchedule: "",
      }).success,
    ).toBe(false);
  });

  it("UT-SCHEMA-MIRROR-002: reconcileSchedule accepts valid crons + empty string", () => {
    const base = {
      ...mirrorSection.defaults,
    };
    for (const cron of [
      "0 2 * * *",
      "0 */6 * * *",
      "*/30 * * * *",
      "17 * * * *",
      "", // disabled
    ]) {
      const result = mirrorSection.schema.safeParse({
        ...base,
        reconcileSchedule: cron,
      });
      expect(result.success).toBe(true);
    }
  });

  it("UT-SCHEMA-MIRROR-003: reconcileSchedule rejects invalid cron expressions", () => {
    const base = { ...mirrorSection.defaults };
    for (const bad of [
      "not-a-cron",
      "61 * * * *", // minute out of range
      "* * * * * * *", // too many fields
      "0 25 * * *", // hour out of range
    ]) {
      const result = mirrorSection.schema.safeParse({
        ...base,
        reconcileSchedule: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("UT-SCHEMA-MIRROR-004: mirror defaults are valid", () => {
    expect(mirrorSection.schema.safeParse(mirrorSection.defaults).success).toBe(
      true,
    );
    expect(mirrorSection.defaults.reconcileSchedule).toBe("0 2 * * *");
  });

  it("UT-SCHEMA-MIRROR-005: owner/repo enforce GitHub naming, empty stays valid (#818)", () => {
    // Path-traversal / slash-bearing repo rejected by REPO_RE.
    expect(
      mirrorSection.schema.safeParse({
        ...mirrorSection.defaults,
        owner: "ChronoAIProject",
        repo: "a/../b",
      }).success,
    ).toBe(false);
    // Empty owner + empty repo = unset state, still valid.
    expect(
      mirrorSection.schema.safeParse({
        ...mirrorSection.defaults,
        owner: "",
        repo: "",
      }).success,
    ).toBe(true);
    // Dotted + dashed repo names are valid GitHub repos.
    for (const repo of ["repo.name", "repo-1"]) {
      expect(
        mirrorSection.schema.safeParse({
          ...mirrorSection.defaults,
          owner: "ChronoAIProject",
          repo,
        }).success,
      ).toBe(true);
    }
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

  it("S2: nyxid rejects loopback chronoStorageUrl/chronoSandboxUrl (#302)", () => {
    const r = nyxidSection.schema.safeParse({
      ...nyxidSection.defaults,
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
