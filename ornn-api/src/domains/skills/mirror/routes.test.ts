/**
 * Route-level tests for the GitHub mirror routes (#872).
 *
 * Mounts `createMirrorRoutes` on a bare Hono app, stubs the upstream
 * auth context (production wires this via proxyAuthSetup) and supplies
 * hand-rolled fakes for the four collaborators (settingsService,
 * skillRepo, mirrorService, mirrorScheduler). The fakes record the
 * arguments the routes pass them so we can assert on the actor shape,
 * the abandon-confirm stamp clear, and the sentinel handling without a
 * real DB.
 *
 * Coverage:
 *   - GET /github/repo: coords + enabled, no credentials, no auth needed
 *   - POST /github/repo validation: enabled / owner / repo / branch /
 *     appId / installationId / appPrivateKey type+regex rejections
 *   - appPrivateKey sentinel handling: mid-mask preserves, "" clears,
 *     fresh PEM validates + stores
 *   - abandon-confirm: 409 without confirm, success + stamp clear with it
 *   - response masks appPrivateKey; putSection receives the auth actor
 *   - 403 when permissions lack ornn:admin:skill
 *   - reconcile: 503 disabled / 503 unconfigured / 202 happy / 409 running
 *   - status: scheduler-backed serialized run + counts, null-scheduler
 *     never_run block
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { generateKeyPairSync } from "node:crypto";
import { createMirrorRoutes, type MirrorRoutesConfig } from "./routes";
import { midMaskSecret, isMidMaskSentinel } from "../../../infra/crypto";
import { buildProblemJsonBody } from "../../../shared/types/index";
import type { MirrorSection } from "../../settings/sections/mirror";
import type { SettingsActor, PutSectionResult } from "../../settings/types";
import type { ReconcileResult } from "./mirrorService";
import type { ScheduledRunStatus } from "./scheduler";

const ADMIN_PERM = "ornn:admin:skill";

function freshPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

const defaultSection: MirrorSection = {
  enabled: true,
  owner: "ChronoAIProject",
  repo: "ornn-skills",
  branch: "main",
  appId: "123456",
  installationId: "7890",
  appPrivateKey: "stored-private-key-value-1234567890",
  reconcileSchedule: "0 2 * * *",
};

// ---- Fakes -----------------------------------------------------------

interface PutCall {
  id: string;
  value: MirrorSection;
  actor: SettingsActor;
}

class FakeSettings {
  putCalls: PutCall[] = [];
  constructor(private section: MirrorSection) {}
  async getMirror(): Promise<MirrorSection> {
    return this.section;
  }
  async putSection<T>(
    id: string,
    value: T,
    actor: SettingsActor,
  ): Promise<PutSectionResult<T>> {
    this.putCalls.push({ id, value: value as MirrorSection, actor });
    this.section = value as MirrorSection;
    return { value, changedFields: [] };
  }
}

interface MirrorCounts {
  eligible: number;
  synced: number;
  lagging: number;
  neverSynced: number;
  oldestUnsyncedAt: Date | null;
}

class FakeSkillRepo {
  clearCalled = 0;
  constructor(private counts: MirrorCounts) {}
  async getMirrorCounts(): Promise<MirrorCounts> {
    return this.counts;
  }
  async clearAllMirrorSyncStamps(): Promise<void> {
    this.clearCalled += 1;
  }
}

interface RuntimeState {
  enabled: boolean;
  configured: boolean;
  owner: string;
  repo: string;
  branch: string;
}

class FakeMirrorService {
  reconcileCalled = 0;
  constructor(
    private runtime: RuntimeState,
    private reconcileResult: ReconcileResult = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
    },
  ) {}
  async getRuntimeState(): Promise<RuntimeState> {
    return this.runtime;
  }
  async reconcileAll(): Promise<ReconcileResult> {
    this.reconcileCalled += 1;
    return this.reconcileResult;
  }
}

class FakeScheduler {
  constructor(private status: ScheduledRunStatus) {}
  async getScheduledRunStatus(): Promise<ScheduledRunStatus> {
    return this.status;
  }
}

// ---- App builder -----------------------------------------------------

function buildApp(
  cfg: Partial<MirrorRoutesConfig>,
  opts: { authenticated?: boolean; permissions?: string[] } = {},
): Hono {
  const { authenticated = true, permissions = [ADMIN_PERM] } = opts;
  const full: MirrorRoutesConfig = {
    mirrorService:
      (cfg.mirrorService as MirrorRoutesConfig["mirrorService"]) ??
      (new FakeMirrorService({
        enabled: true,
        configured: true,
        owner: "o",
        repo: "r",
        branch: "main",
      }) as unknown as MirrorRoutesConfig["mirrorService"]),
    settingsService:
      (cfg.settingsService as MirrorRoutesConfig["settingsService"]) ??
      (new FakeSettings(defaultSection) as unknown as MirrorRoutesConfig["settingsService"]),
    skillRepo:
      (cfg.skillRepo as MirrorRoutesConfig["skillRepo"]) ??
      (new FakeSkillRepo({
        eligible: 0,
        synced: 0,
        lagging: 0,
        neverSynced: 0,
        oldestUnsyncedAt: null,
      }) as unknown as MirrorRoutesConfig["skillRepo"]),
    mirrorScheduler:
      (cfg.mirrorScheduler as MirrorRoutesConfig["mirrorScheduler"]) ?? null,
  };

  const app = new Hono();
  if (authenticated) {
    app.use("*", async (c, next) => {
      c.set("auth" as never, {
        userId: "u-admin",
        email: "admin@test.local",
        displayName: "Admin",
        permissions,
      } as never);
      await next();
    });
  }
  app.route("/api/v1", createMirrorRoutes(full));
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = buildProblemJsonBody({
      statusCode: status,
      code,
      message: err.message,
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, status as never, {
      "Content-Type": "application/problem+json",
    });
  });
  return app;
}

// ---- GET /github/repo ------------------------------------------------

describe("GET /github/repo", () => {
  it("returns coords + enabled, no credentials, and needs no auth", async () => {
    const settings = new FakeSettings(defaultSection);
    const app = buildApp(
      { settingsService: settings as unknown as MirrorRoutesConfig["settingsService"] },
      { authenticated: false },
    );
    const res = await app.request("/api/v1/github/repo");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: Record<string, unknown> };
    expect(parsed.data).toEqual({
      owner: "ChronoAIProject",
      repo: "ornn-skills",
      branch: "main",
      enabled: true,
    });
    // Sensitive fields never leak on the public read.
    expect("appId" in parsed.data).toBe(false);
    expect("appPrivateKey" in parsed.data).toBe(false);
    expect("installationId" in parsed.data).toBe(false);
  });
});

// ---- POST /github/repo: validation -----------------------------------

async function postRepo(
  body: unknown,
  opts: { permissions?: string[]; settings?: FakeSettings; skillRepo?: FakeSkillRepo } = {},
) {
  const settings = opts.settings ?? new FakeSettings(defaultSection);
  const skillRepo =
    opts.skillRepo ??
    new FakeSkillRepo({
      eligible: 0,
      synced: 0,
      lagging: 0,
      neverSynced: 0,
      oldestUnsyncedAt: null,
    });
  const app = buildApp(
    {
      settingsService: settings as unknown as MirrorRoutesConfig["settingsService"],
      skillRepo: skillRepo as unknown as MirrorRoutesConfig["skillRepo"],
    },
    opts.permissions ? { permissions: opts.permissions } : {},
  );
  const res = await app.request("/api/v1/github/repo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, settings, skillRepo };
}

describe("POST /github/repo — validation rejections (400)", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["non-boolean enabled", { enabled: "yes" }],
    ["bad owner", { owner: "-bad-owner-" }],
    ["bad repo", { repo: "no spaces allowed" }],
    ["bad branch (control char)", { branch: "feat\u0001ure" }],
    ["bad appId (non-digit)", { appId: "abc" }],
    ["bad installationId (non-digit)", { installationId: "12x" }],
    ["non-string appPrivateKey", { appPrivateKey: 12345 }],
  ];
  for (const [label, body] of cases) {
    it(`rejects ${label}`, async () => {
      const { res } = await postRepo(body);
      expect(res.status).toBe(400);
    });
  }
});

// ---- POST /github/repo: appPrivateKey sentinel handling --------------

describe("POST /github/repo — appPrivateKey sentinel handling", () => {
  it("mid-mask sentinel preserves the stored key", async () => {
    const settings = new FakeSettings(defaultSection);
    const masked = midMaskSecret(defaultSection.appPrivateKey);
    const { res } = await postRepo({ appPrivateKey: masked }, { settings });
    expect(res.status).toBe(200);
    expect(settings.putCalls[0]!.value.appPrivateKey).toBe(
      defaultSection.appPrivateKey,
    );
  });

  it('empty string clears the stored key', async () => {
    const settings = new FakeSettings(defaultSection);
    const { res } = await postRepo({ appPrivateKey: "" }, { settings });
    expect(res.status).toBe(200);
    expect(settings.putCalls[0]!.value.appPrivateKey).toBe("");
  });

  it("a fresh real PEM validates and is stored", async () => {
    const settings = new FakeSettings(defaultSection);
    const pem = freshPem();
    const { res } = await postRepo({ appPrivateKey: pem }, { settings });
    expect(res.status).toBe(200);
    expect(settings.putCalls[0]!.value.appPrivateKey).toBe(pem.trim());
  });
});

// ---- POST /github/repo: abandon-confirm ------------------------------

describe("POST /github/repo — abandon-confirm on coord change", () => {
  it("returns 409 when changing coords would abandon stamped skills without confirm", async () => {
    const settings = new FakeSettings(defaultSection);
    const skillRepo = new FakeSkillRepo({
      eligible: 5,
      synced: 3,
      lagging: 1,
      neverSynced: 1,
      oldestUnsyncedAt: null,
    });
    const { res } = await postRepo({ owner: "NewOwner" }, { settings, skillRepo });
    expect(res.status).toBe(409);
    expect(skillRepo.clearCalled).toBe(0);
    expect(settings.putCalls.length).toBe(0);
  });

  it("succeeds + clears stamps when confirmAbandonOldRepo is true", async () => {
    const settings = new FakeSettings(defaultSection);
    const skillRepo = new FakeSkillRepo({
      eligible: 5,
      synced: 3,
      lagging: 1,
      neverSynced: 1,
      oldestUnsyncedAt: null,
    });
    const { res } = await postRepo(
      { owner: "NewOwner", confirmAbandonOldRepo: true },
      { settings, skillRepo },
    );
    expect(res.status).toBe(200);
    expect(skillRepo.clearCalled).toBe(1);
    expect(settings.putCalls[0]!.value.owner).toBe("NewOwner");
  });
});

// ---- POST /github/repo: response + actor + permission ----------------

describe("POST /github/repo — response masking, actor, permission gate", () => {
  it("mid-masks appPrivateKey in the response body (never plaintext)", async () => {
    const settings = new FakeSettings(defaultSection);
    const { res } = await postRepo({ enabled: false }, { settings });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes(defaultSection.appPrivateKey)).toBe(false);
    const parsed = JSON.parse(text) as { data: { appPrivateKey: string } };
    expect(isMidMaskSentinel(parsed.data.appPrivateKey)).toBe(true);
  });

  it("passes the auth actor through to putSection", async () => {
    const settings = new FakeSettings(defaultSection);
    const { res } = await postRepo({ enabled: false }, { settings });
    expect(res.status).toBe(200);
    expect(settings.putCalls[0]!.actor).toEqual({
      userId: "u-admin",
      email: "admin@test.local",
      displayName: "Admin",
    });
  });

  it("returns 403 when the caller lacks ornn:admin:skill", async () => {
    const { res } = await postRepo({ enabled: false }, { permissions: ["ornn:read"] });
    expect(res.status).toBe(403);
  });
});

// ---- POST /admin/mirror/reconcile ------------------------------------

describe("POST /admin/mirror/reconcile", () => {
  async function reconcile(runtime: RuntimeState) {
    const svc = new FakeMirrorService(runtime);
    const app = buildApp({
      mirrorService: svc as unknown as MirrorRoutesConfig["mirrorService"],
    });
    const res = await app.request("/api/v1/admin/mirror/reconcile", {
      method: "POST",
    });
    return { res, svc };
  }

  it("returns 503 when the mirror is disabled", async () => {
    const { res } = await reconcile({
      enabled: false,
      configured: true,
      owner: "o",
      repo: "r",
      branch: "main",
    });
    expect(res.status).toBe(503);
  });

  it("returns 503 when the mirror is unconfigured", async () => {
    const { res } = await reconcile({
      enabled: true,
      configured: false,
      owner: "o",
      repo: "r",
      branch: "main",
    });
    expect(res.status).toBe(503);
  });

  it("returns 202 running on the happy path", async () => {
    const { res } = await reconcile({
      enabled: true,
      configured: true,
      owner: "o",
      repo: "r",
      branch: "main",
    });
    expect(res.status).toBe(202);
    const parsed = (await res.json()) as { data: { status: string } };
    expect(parsed.data.status).toBe("running");
  });

  it("returns 409 when a reconcile is already running", async () => {
    // reconcileAll never settles → the run stays in `running` state so a
    // second immediate kick hits the already-running 409 guard.
    const svc = new FakeMirrorService({
      enabled: true,
      configured: true,
      owner: "o",
      repo: "r",
      branch: "main",
    });
    const hold: { release: () => void } = { release: () => {} };
    svc.reconcileAll = () =>
      new Promise<ReconcileResult>((resolve) => {
        hold.release = () =>
          resolve({ added: 0, updated: 0, removed: 0, unchanged: 0 });
      });
    const app = buildApp({
      mirrorService: svc as unknown as MirrorRoutesConfig["mirrorService"],
    });
    const first = await app.request("/api/v1/admin/mirror/reconcile", {
      method: "POST",
    });
    expect(first.status).toBe(202);
    const second = await app.request("/api/v1/admin/mirror/reconcile", {
      method: "POST",
    });
    expect(second.status).toBe(409);
    // Let the background run settle so it doesn't leak past the test.
    hold.release();
  });
});

// ---- GET /admin/mirror/status ----------------------------------------

describe("GET /admin/mirror/status", () => {
  it("serializes the scheduled run + counts when a scheduler is wired", async () => {
    const lastRunAt = new Date("2026-06-05T02:00:00.000Z");
    const lastFinishedAt = new Date("2026-06-05T02:01:00.000Z");
    const oldestUnsyncedAt = new Date("2026-06-01T00:00:00.000Z");
    const scheduler = new FakeScheduler({
      status: "succeeded",
      lastRunAt,
      lastFinishedAt,
      lastDurationMs: 60_000,
      lastError: null,
      nextRunAt: new Date("2026-06-06T02:00:00.000Z"),
    });
    const skillRepo = new FakeSkillRepo({
      eligible: 10,
      synced: 7,
      lagging: 2,
      neverSynced: 1,
      oldestUnsyncedAt,
    });
    const app = buildApp({
      mirrorScheduler: scheduler as unknown as MirrorRoutesConfig["mirrorScheduler"],
      skillRepo: skillRepo as unknown as MirrorRoutesConfig["skillRepo"],
    });
    const res = await app.request("/api/v1/admin/mirror/status");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      data: {
        counts: { eligible: number; oldestUnsyncedAt: string | null };
        scheduledRun: { status: string; lastRunAt: string | null };
        appPrivateKey: string;
      };
    };
    expect(parsed.data.counts.eligible).toBe(10);
    expect(parsed.data.counts.oldestUnsyncedAt).toBe(oldestUnsyncedAt.toISOString());
    expect(parsed.data.scheduledRun.status).toBe("succeeded");
    expect(parsed.data.scheduledRun.lastRunAt).toBe(lastRunAt.toISOString());
    // App key is mid-masked here too.
    expect(isMidMaskSentinel(parsed.data.appPrivateKey)).toBe(true);
  });

  it("reports a never_run scheduled block when the scheduler is null", async () => {
    const app = buildApp({ mirrorScheduler: null });
    const res = await app.request("/api/v1/admin/mirror/status");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      data: { scheduledRun: { status: string; lastRunAt: string | null } };
    };
    expect(parsed.data.scheduledRun.status).toBe("never_run");
    expect(parsed.data.scheduledRun.lastRunAt).toBeNull();
  });
});
