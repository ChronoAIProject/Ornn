/**
 * UT-SETSVC-001..009 — SettingsServiceImpl unit tests against an
 * in-memory repository fake.
 *
 * @module domains/settings/service.test
 */

import { describe, expect, it } from "bun:test";
import { encryptSecret, midMaskSecret, redactSentinel } from "../../infra/crypto";
import { SettingsServiceImpl } from "./service";
import type { StoredSection } from "./repository";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";

const ACTOR = { userId: "u-admin", email: "admin@test.local", displayName: "Admin" };

class FakeRepo {
  rows = new Map<string, StoredSection>();
  getCalls = 0;
  putCalls = 0;

  async getSection(id: string): Promise<StoredSection | null> {
    this.getCalls += 1;
    return this.rows.get(id) ?? null;
  }
  async listSections(): Promise<ReadonlyArray<StoredSection>> {
    return [...this.rows.values()];
  }
  async putSection(id: string, value: unknown, actor: string): Promise<void> {
    this.putCalls += 1;
    this.rows.set(id, {
      _id: id,
      value,
      updatedAt: new Date(),
      updatedBy: actor,
    });
  }
}

function makeService(opts: { ttlMs?: number; clock?: () => number } = {}) {
  const repo = new FakeRepo();
  const svc = new SettingsServiceImpl({
    repo: repo as unknown as import("./repository").SettingsRepository,
    encryptionKey: KEY,
    cacheTtlMs: opts.ttlMs ?? 30_000,
    clock: opts.clock ?? (() => Date.now()),
  });
  return { svc, repo };
}

describe("SettingsServiceImpl", () => {
  it("UT-SETSVC-001: TTL cache hit avoids repo on second call", async () => {
    const { svc, repo } = makeService();
    await svc.getPlayground();
    const callsAfterFirst = repo.getCalls;
    await svc.getPlayground();
    expect(repo.getCalls).toBe(callsAfterFirst); // no new DB hit
  });

  it("UT-SETSVC-002: TTL cache miss after expiry triggers new repo read", async () => {
    let now = 1_000_000;
    const { svc, repo } = makeService({ ttlMs: 30_000, clock: () => now });
    await svc.getPlayground();
    const before = repo.getCalls;
    now += 31_000; // advance past TTL
    await svc.getPlayground();
    expect(repo.getCalls).toBeGreaterThan(before);
  });

  it("UT-SETSVC-003: putSection invalidates cache, get returns new value", async () => {
    const { svc } = makeService();
    const initial = await svc.getPlayground();
    expect(initial.defaultMonthlyQuota).toBe(200);
    await svc.putSection(
      "playground",
      {
        ...initial,
        defaultMonthlyQuota: 500,
      },
      ACTOR,
    );
    const after = await svc.getPlayground();
    expect(after.defaultMonthlyQuota).toBe(500);
  });

  it("UT-SETSVC-004: encryption round-trip — plaintext on internal get, ciphertext in DB", async () => {
    const { svc, repo } = makeService();
    await svc.putSection(
      "mirror",
      {
        enabled: true,
        owner: "ChronoAIProject",
        repo: "ornn-skills",
        branch: "main",
        appId: "12345",
        installationId: "67890",
        appPrivateKey: "-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----",
      },
      ACTOR,
    );
    const stored = await repo.getSection("mirror");
    const storedValue = stored?.value as Record<string, string>;
    expect(storedValue.appPrivateKey).toMatch(/^v1:/); // ciphertext on disk
    const internal = await svc.getMirror();
    expect(internal.appPrivateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("UT-SETSVC-006: redaction sentinel preserves DB value", async () => {
    const { svc } = makeService();
    await svc.putSection(
      "mirror",
      {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "real-secret-pem",
      },
      ACTOR,
    );
    // Now PUT again with the redaction sentinel — the secret must remain.
    await svc.putSection(
      "mirror",
      {
        enabled: false, // toggle a non-secret to confirm a real write happened
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: redactSentinel("appPrivateKey"),
      },
      ACTOR,
    );
    const after = await svc.getMirror();
    expect(after.appPrivateKey).toBe("real-secret-pem");
    expect(after.enabled).toBe(false);
  });

  it("UT-SETSVC-006b: mid-mask sentinel also preserves DB value", async () => {
    const { svc } = makeService();
    await svc.putSection(
      "mirror",
      {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "another-real-secret-value",
      },
      ACTOR,
    );
    const masked = midMaskSecret("another-real-secret-value");
    await svc.putSection(
      "mirror",
      {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: masked,
      },
      ACTOR,
    );
    const after = await svc.getMirror();
    expect(after.appPrivateKey).toBe("another-real-secret-value");
  });

  it("UT-SETSVC-007: concurrent putSection — last write wins", async () => {
    const { svc } = makeService();
    const base = await svc.getPlayground();
    await Promise.all([
      svc.putSection(
        "playground",
        { ...base, defaultMonthlyQuota: 100 },
        ACTOR,
      ),
      svc.putSection(
        "playground",
        { ...base, defaultMonthlyQuota: 999 },
        ACTOR,
      ),
    ]);
    const final = await svc.getPlayground();
    expect([100, 999]).toContain(final.defaultMonthlyQuota);
  });

  it("UT-SETSVC-008: validation error includes section field path", async () => {
    const { svc } = makeService();
    let err: unknown = null;
    try {
      await svc.putSection(
        "playground",
        {
          defaultProviderId: null,
          defaultModelId: null,
          sseKeepAliveMs: 100, // below min 1000
        },
        ACTOR,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as { code: string }).code).toBe("INVALID_SETTING");
    expect((err as { message: string }).message).toContain("sseKeepAliveMs");
  });

  it("UT-SETSVC-009: cache scoped per section — putting playground does not affect skillGen", async () => {
    const { svc } = makeService();
    await svc.getSkillGen(); // primes skillGen cache
    await svc.putSection(
      "playground",
      {
        defaultProviderId: "p1",
        defaultModelId: "m1",
        sseKeepAliveMs: 5000,
        defaultMonthlyQuota: 200,
      },
      ACTOR,
    );
    // skillGen cache should still be usable; playground was the only one busted
    const sg = await svc.getSkillGen();
    expect(sg.defaultProviderId).toBeNull(); // default
    const pg = await svc.getPlayground();
    expect(pg.defaultProviderId).toBe("p1");
  });

  it("UT-SETSVC-extra: corrupted ciphertext degrades gracefully to empty", async () => {
    const { svc, repo } = makeService();
    repo.rows.set("mirror", {
      _id: "mirror",
      value: {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "v1:dead:beef:cafe", // garbage ciphertext
      },
      updatedAt: new Date(),
      updatedBy: "system",
    });
    const m = await svc.getMirror();
    expect(m.appPrivateKey).toBe("");
  });

  it("UT-SETSVC-extra: legacy plaintext appPrivateKey passes through", async () => {
    const { svc, repo } = makeService();
    repo.rows.set("mirror", {
      _id: "mirror",
      value: {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "plain-old-pem", // legacy unprefixed value
      },
      updatedAt: new Date(),
      updatedBy: "system",
    });
    const m = await svc.getMirror();
    expect(m.appPrivateKey).toBe("plain-old-pem");
  });

  it("UT-SETSVC-pre-encrypt: encryptSecret integration sanity", async () => {
    // Sanity check: encrypted values stored directly in DB decrypt correctly
    // through the service path.
    const { svc, repo } = makeService();
    const ct = encryptSecret("manually-stored-secret", KEY);
    repo.rows.set("mirror", {
      _id: "mirror",
      value: {
        enabled: false,
        owner: "",
        repo: "",
        branch: "",
        appId: "",
        installationId: "",
        appPrivateKey: ct,
      },
      updatedAt: new Date(),
      updatedBy: "seed",
    });
    const m = await svc.getMirror();
    expect(m.appPrivateKey).toBe("manually-stored-secret");
  });
});
