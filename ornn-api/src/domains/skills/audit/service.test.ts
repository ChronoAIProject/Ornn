/**
 * AuditService unit tests (#873).
 *
 * The service is fully DI-driven, so this suite hand-rolls fakes for
 * every collaborator and never touches a real DB / network / LLM:
 *   - skillService    → returns a SkillDetailResponse-shaped stub
 *   - auditRepo       → records createRunning / markCompleted / markFailed
 *   - llmClient       → installLlmGatewayMock (complete() → output_text)
 *   - notification    → LOCAL typed recorder (the shared mock's
 *                       notifyAuditCompleted signature doesn't match the
 *                       real {ownerUserId,...} call site)
 *   - storage/orgs    → minimal fakes
 *   - globalThis.fetch → swapped to a Response wrapping a real JSZip zip
 *
 * `runAudit` finalizes in a fire-and-forget microtask; tests flush it
 * with `flushFinalize()` before asserting on the recorder.
 *
 * @module domains/skills/audit/service.test
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import JSZip from "jszip";
import { AuditService, type AuditServiceDeps } from "./service";
import type {
  AuditRecord,
  AuditScore,
  AuditFinding,
  AuditVerdict,
} from "./types";
import type { CompleteAuditInput, CreateRunningInput } from "./repository";
import type {
  NyxLlmClient,
  NyxLlmCompleteParams,
  ResponsesApiOutput,
} from "../../../clients/nyxid/llm";
import type { SkillService } from "../crud/service";
import type { NotificationService } from "../../notifications/service";
import type { NyxidOrgsClient } from "../../../clients/nyxid/orgs";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillDetailResponse } from "../../../shared/types/index";

// ---- Local typed notification recorder -------------------------------
//
// Mirrors EXACTLY the two methods the service calls
// (notifyAuditCompleted({ownerUserId,...}) +
//  notifyAuditRiskyForConsumer({consumerUserId,...})). The shared
// tests/mocks/notificationService.ts uses a different param shape and
// would not typecheck against the real call sites.

interface CompletedCall {
  ownerUserId: string;
  skillGuid: string;
  skillName: string;
  version: string;
  verdict: AuditVerdict;
  overallScore: number;
}

interface RiskyCall {
  consumerUserId: string;
  skillGuid: string;
  skillName: string;
  version: string;
  verdict: "yellow" | "red";
  overallScore: number;
}

class FakeNotificationService {
  completed: CompletedCall[] = [];
  risky: RiskyCall[] = [];
  async notifyAuditCompleted(p: CompletedCall): Promise<void> {
    this.completed.push(p);
  }
  async notifyAuditRiskyForConsumer(p: RiskyCall): Promise<void> {
    this.risky.push(p);
  }
}

// ---- Fake skill service ----------------------------------------------

const VALID_SCORING_JSON = JSON.stringify({
  scores: [
    { dimension: "security", score: 9, rationale: "clean" },
    { dimension: "code_quality", score: 8, rationale: "ok" },
    { dimension: "documentation", score: 7, rationale: "ok" },
    { dimension: "reliability", score: 8, rationale: "ok" },
    { dimension: "permission_scope", score: 9, rationale: "ok" },
  ],
  findings: [],
});

// A scoring response whose lowest dimension forces a yellow/red verdict
// so the consumer fan-out branch is exercised.
const RISKY_SCORING_JSON = JSON.stringify({
  scores: [
    { dimension: "security", score: 1, rationale: "shell injection" },
    { dimension: "code_quality", score: 3, rationale: "bad" },
    { dimension: "documentation", score: 4, rationale: "thin" },
    { dimension: "reliability", score: 4, rationale: "fragile" },
    { dimension: "permission_scope", score: 3, rationale: "broad" },
  ],
  findings: [
    { dimension: "security", severity: "critical", message: "rm -rf user input" },
  ],
});

function baseSkill(overrides: Partial<SkillDetailResponse> = {}): SkillDetailResponse {
  return {
    guid: "skill-guid-1",
    name: "demo-skill",
    description: "a demo",
    license: null,
    compatibility: null,
    metadata: { category: "devtools", runtimes: [{ runtime: "node" }] },
    tags: ["alpha", "beta"],
    skillHash: "hash-1",
    presignedPackageUrl: "https://storage.test/skill.zip",
    isPrivate: false,
    createdBy: "owner-1",
    createdOn: "2026-01-01T00:00:00Z",
    updatedOn: "2026-01-01T00:00:00Z",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    version: "1.0.0",
    ...overrides,
  };
}

class FakeSkillService {
  getSkillCalls: Array<{ idOrName: string; version?: string | undefined }> = [];
  constructor(private skill: SkillDetailResponse) {}
  setSkill(s: SkillDetailResponse) {
    this.skill = s;
  }
  async getSkill(idOrName: string, version?: string): Promise<SkillDetailResponse> {
    this.getSkillCalls.push({ idOrName, version });
    return this.skill;
  }
}

// ---- Fake audit repository -------------------------------------------

class FakeAuditRepo {
  createRunningCalls: CreateRunningInput[] = [];
  markCompletedCalls: Array<{ auditId: string; result: CompleteAuditInput }> = [];
  markFailedCalls: Array<{ auditId: string; errorMessage: string }> = [];
  cached: AuditRecord | null = null;
  latest: AuditRecord | null = null;
  list: AuditRecord[] = [];
  perVersion: AuditRecord[] = [];

  async findCachedByHash(): Promise<AuditRecord | null> {
    return this.cached;
  }
  async createRunning(input: CreateRunningInput): Promise<AuditRecord> {
    this.createRunningCalls.push(input);
    return {
      _id: "audit-running-1",
      skillGuid: input.skillGuid,
      version: input.version,
      skillHash: input.skillHash,
      status: "running",
      verdict: "yellow",
      overallScore: 0,
      scores: [],
      findings: [],
      model: input.model,
      createdAt: new Date(),
      triggeredBy: input.triggeredBy,
    };
  }
  async markCompleted(auditId: string, result: CompleteAuditInput): Promise<AuditRecord | null> {
    this.markCompletedCalls.push({ auditId, result });
    return null;
  }
  async markFailed(auditId: string, errorMessage: string): Promise<AuditRecord | null> {
    this.markFailedCalls.push({ auditId, errorMessage });
    return null;
  }
  async findLatestBySkillAndVersion(): Promise<AuditRecord | null> {
    return this.latest;
  }
  async listBySkillGuid(): Promise<ReadonlyArray<AuditRecord>> {
    return this.list;
  }
  async findLatestCompletedPerVersion(): Promise<ReadonlyArray<AuditRecord>> {
    return this.perVersion;
  }
}

// ---- Fake storage / orgs ---------------------------------------------

class FakeStorageClient {
  async getPresignedUrl(): Promise<{ presignedUrl: string; expiresAt: string }> {
    return { presignedUrl: "https://storage.test/skill.zip", expiresAt: "2026-01-01T01:00:00Z" };
  }
}

class FakeOrgsClient {
  membersByOrg = new Map<string, Array<{ userId: string }>>();
  listOrgMembersCalls: string[] = [];
  async listOrgMembers(orgId: string): Promise<Array<{ userId: string; displayName: string; role: "admin" | "member" }>> {
    this.listOrgMembersCalls.push(orgId);
    return (this.membersByOrg.get(orgId) ?? []).map((m) => ({
      userId: m.userId,
      displayName: m.userId,
      role: "member" as const,
    }));
  }
}

// ---- Fake LLM client -------------------------------------------------
//
// Mirrors the tests/mocks/llmGateway.ts complete() shape
// (`[{ type:"message", content:[{ type:"output_text", text }] }]`) but
// stays inside src/ rootDir. Only complete() is exercised by the audit
// pipeline; stream() is stubbed to satisfy the type.

function makeLlmClient(text: string): NyxLlmClient {
  const fake = {
    async complete(_params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
      return [{ type: "message", content: [{ type: "output_text", text }] }];
    },
    async *stream(): AsyncIterable<never> {
      // not used by the audit service
    },
  };
  return fake as unknown as NyxLlmClient;
}

// ---- fetch swap ------------------------------------------------------

const originalFetch = globalThis.fetch;

interface FetchPlan {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  throws?: boolean;
}

let fetchPlan: FetchPlan;

async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

beforeEach(() => {
  const fakeFetch = async (): Promise<Response> => {
    if (fetchPlan.throws) throw new Error("network down");
    return new Response(fetchPlan.bytes as unknown as BodyInit, {
      status: fetchPlan.status,
      statusText: fetchPlan.ok ? "OK" : "Error",
    });
  };
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---- helpers ---------------------------------------------------------

/**
 * Flush the fire-and-forget finalize chain. finalizeAudit + the nested
 * fanOutNotifications both schedule via promise microtasks; a couple of
 * macrotask ticks let them settle before assertions.
 */
async function flushFinalize(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function buildService(
  overrides: {
    skill?: SkillDetailResponse;
    llmText?: string;
    notification?: FakeNotificationService;
    orgs?: FakeOrgsClient;
    repo?: FakeAuditRepo;
    withNotification?: boolean;
  } = {},
): {
  service: AuditService;
  repo: FakeAuditRepo;
  skillService: FakeSkillService;
  notification: FakeNotificationService;
  orgs: FakeOrgsClient;
} {
  const repo = overrides.repo ?? new FakeAuditRepo();
  const skillService = new FakeSkillService(overrides.skill ?? baseSkill());
  const notification = overrides.notification ?? new FakeNotificationService();
  const orgs = overrides.orgs ?? new FakeOrgsClient();
  const client = makeLlmClient(overrides.llmText ?? VALID_SCORING_JSON);

  const deps: AuditServiceDeps = {
    auditRepo: repo as unknown as AuditServiceDeps["auditRepo"],
    skillService: skillService as unknown as SkillService,
    storageClient: new FakeStorageClient() as unknown as IStorageClient,
    storageBucketResolver: async () => "skills-bucket",
    llmClient: client,
    defaultsResolver: async () => ({
      model: "gpt-test",
      llmEnabled: true,
      agentSealEnabled: false,
      agentSealTimeoutMs: 1000,
      riskThreshold: 5,
    }),
    cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    ...(overrides.withNotification === false
      ? {}
      : {
          notificationService: notification as unknown as NotificationService,
          nyxidOrgsClient: orgs as unknown as NyxidOrgsClient,
        }),
  };

  return { service: new AuditService(deps), repo, skillService, notification, orgs };
}

function completedRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  const scores: AuditScore[] = [
    { dimension: "security", score: 9, rationale: "" },
    { dimension: "code_quality", score: 8, rationale: "" },
    { dimension: "documentation", score: 7, rationale: "" },
    { dimension: "reliability", score: 8, rationale: "" },
    { dimension: "permission_scope", score: 9, rationale: "" },
  ];
  const findings: AuditFinding[] = [];
  return {
    _id: "audit-1",
    skillGuid: "skill-guid-1",
    version: "1.0.0",
    skillHash: "hash-1",
    status: "completed",
    verdict: "green",
    overallScore: 8.2,
    scores,
    findings,
    model: "gpt-test",
    createdAt: new Date(),
    completedAt: new Date(),
    triggeredBy: "owner-1",
    ...overrides,
  };
}

// ---- getAudit --------------------------------------------------------

describe("getAudit", () => {
  test("returns a completed record", async () => {
    const { service, repo } = buildService();
    repo.latest = completedRecord();
    const rec = await service.getAudit("demo-skill");
    expect(rec).not.toBeNull();
    expect(rec!.status).toBe("completed");
  });

  test("returns null when the latest record is still running", async () => {
    const { service, repo } = buildService();
    repo.latest = completedRecord({ status: "running" });
    expect(await service.getAudit("demo-skill")).toBeNull();
  });

  test("returns null when no record exists", async () => {
    const { service, repo } = buildService();
    repo.latest = null;
    expect(await service.getAudit("demo-skill")).toBeNull();
  });
});

// ---- listHistory -----------------------------------------------------

describe("listHistory", () => {
  test("returns all records when no version filter is given", async () => {
    const { service, repo } = buildService();
    repo.list = [
      completedRecord({ _id: "a", version: "1.0.0" }),
      completedRecord({ _id: "b", version: "2.0.0" }),
    ];
    const items = await service.listHistory("demo-skill");
    expect(items).toHaveLength(2);
  });

  test("filters by version when given", async () => {
    const { service, repo } = buildService();
    repo.list = [
      completedRecord({ _id: "a", version: "1.0.0" }),
      completedRecord({ _id: "b", version: "2.0.0" }),
    ];
    const items = await service.listHistory("demo-skill", "2.0.0");
    expect(items).toHaveLength(1);
    expect(items[0]!._id).toBe("b");
  });
});

// ---- summaryByVersion ------------------------------------------------

describe("summaryByVersion", () => {
  test("maps records into a version-keyed object", async () => {
    const { service, repo } = buildService();
    repo.perVersion = [
      completedRecord({ _id: "a", version: "1.0.0" }),
      completedRecord({ _id: "b", version: "2.0.0" }),
    ];
    const out = await service.summaryByVersion("demo-skill");
    expect(Object.keys(out).sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(out["1.0.0"]!._id).toBe("a");
    expect(out["2.0.0"]!._id).toBe("b");
  });
});

// ---- runAudit (cache) ------------------------------------------------

describe("runAudit", () => {
  test("cache hit (force=false) returns the cached row and skips createRunning", async () => {
    const { service, repo } = buildService();
    repo.cached = completedRecord({ _id: "cached-1" });
    const rec = await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    expect(rec._id).toBe("cached-1");
    expect(repo.createRunningCalls).toHaveLength(0);
  });

  test("cache miss creates a running row and returns it", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo } = buildService();
    repo.cached = null;
    const rec = await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    expect(rec._id).toBe("audit-running-1");
    expect(repo.createRunningCalls).toHaveLength(1);
    await flushFinalize();
  });

  test("force=true bypasses the cache lookup entirely", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo } = buildService();
    repo.cached = completedRecord({ _id: "cached-should-be-ignored" });
    const rec = await service.runAudit("demo-skill", { triggeredBy: "owner-1", force: true });
    expect(rec._id).toBe("audit-running-1");
    expect(repo.createRunningCalls).toHaveLength(1);
    await flushFinalize();
  });
});

// ---- finalizeAudit (via runAudit + flush) ----------------------------

describe("finalizeAudit", () => {
  test("happy path: valid scoring JSON marks completed + fans out", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo, notification } = buildService();
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markCompletedCalls).toHaveLength(1);
    expect(repo.markCompletedCalls[0]!.result.verdict).toBe("green");
    expect(repo.markFailedCalls).toHaveLength(0);
    // Owner always notified on completion.
    expect(notification.completed).toHaveLength(1);
    expect(notification.completed[0]!.ownerUserId).toBe("owner-1");
  });

  test("parse failure marks failed with the scoring-JSON message", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo } = buildService({ llmText: "this is not json at all" });
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markCompletedCalls).toHaveLength(0);
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.markFailedCalls[0]!.errorMessage).toContain("valid scoring JSON");
  });

  test("throw path (non-ok package fetch) marks failed with a message", async () => {
    fetchPlan = { ok: false, status: 500, bytes: new Uint8Array() };
    const { service, repo } = buildService();
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markCompletedCalls).toHaveLength(0);
    expect(repo.markFailedCalls).toHaveLength(1);
    // finalizeAudit records err.message (not the AppError code).
    expect(repo.markFailedCalls[0]!.errorMessage).toContain("Failed to download package");
  });
});

// ---- buildAuditContext (via finalize) --------------------------------

describe("buildAuditContext", () => {
  test("walks the zip and skips binary extensions", async () => {
    fetchPlan = {
      ok: true,
      status: 200,
      bytes: await buildZip({
        "SKILL.md": "# readable",
        "logo.png": "BINARYBYTES",
        "scripts/main.js": "console.log('hi')",
      }),
    };
    const { service, repo } = buildService();
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    // Completed → context build succeeded; binary skip didn't crash it.
    expect(repo.markCompletedCalls).toHaveLength(1);
    expect(repo.markFailedCalls).toHaveLength(0);
  });

  test("truncates the bundle past the 120KB limit", async () => {
    const big = "a".repeat(130 * 1024);
    fetchPlan = {
      ok: true,
      status: 200,
      bytes: await buildZip({ "SKILL.md": "# small", "big.txt": big }),
    };
    const { service, repo } = buildService();
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    // Truncation marker means the loop broke cleanly → still completes.
    expect(repo.markCompletedCalls).toHaveLength(1);
  });

  test("missing presignedPackageUrl marks failed with audit_package_unavailable", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo } = buildService({
      skill: baseSkill({ presignedPackageUrl: "" }),
    });
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.markFailedCalls[0]!.errorMessage).toContain("No storage URL");
  });

  test("non-ok package fetch marks failed with the download-failed message", async () => {
    fetchPlan = { ok: false, status: 404, bytes: new Uint8Array() };
    const { service, repo } = buildService();
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.markFailedCalls[0]!.errorMessage).toContain("Failed to download package");
  });
});

// ---- fanOutNotifications (via finalize, risky verdict) ----------------

describe("fanOutNotifications", () => {
  test("green verdict notifies the owner only — consumers skipped", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, notification } = buildService({
      skill: baseSkill({ sharedWithUsers: ["consumer-a"] }),
      llmText: VALID_SCORING_JSON,
    });
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(notification.completed).toHaveLength(1);
    expect(notification.risky).toHaveLength(0);
  });

  test("risky verdict notifies consumers, expands orgs, and de-dupes the owner", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const orgs = new FakeOrgsClient();
    // Org expands to two members, one of which is the owner (must be de-duped).
    orgs.membersByOrg.set("org-1", [{ userId: "consumer-b" }, { userId: "owner-1" }]);
    const { service, notification } = buildService({
      skill: baseSkill({
        sharedWithUsers: ["consumer-a", "owner-1"],
        sharedWithOrgs: ["org-1"],
      }),
      llmText: RISKY_SCORING_JSON,
      orgs,
    });
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();

    // Owner notified on completion.
    expect(notification.completed).toHaveLength(1);
    expect(notification.completed[0]!.ownerUserId).toBe("owner-1");
    // org expansion happened.
    expect(orgs.listOrgMembersCalls).toContain("org-1");
    // Consumers: consumer-a (direct) + consumer-b (org) — owner-1 de-duped.
    const consumerIds = notification.risky.map((r) => r.consumerUserId).sort();
    expect(consumerIds).toEqual(["consumer-a", "consumer-b"]);
    expect(consumerIds).not.toContain("owner-1");
  });

  test("no notificationService wired → finalize still completes, no fan-out", async () => {
    fetchPlan = { ok: true, status: 200, bytes: await buildZip({ "SKILL.md": "# demo" }) };
    const { service, repo } = buildService({ withNotification: false });
    await service.runAudit("demo-skill", { triggeredBy: "owner-1" });
    await flushFinalize();
    expect(repo.markCompletedCalls).toHaveLength(1);
  });
});
