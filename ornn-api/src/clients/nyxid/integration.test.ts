import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { SettingsServiceImpl } from "../../domains/settings/service";
import { createSettingsRoutes } from "../../domains/settings/routes";
import type { SettingsRepository, StoredSection } from "../../domains/settings/repository";
import { createNyxidIntegration } from "./integration";
import { StorageClient } from "../storageClient";
import { deferred, tokenHarness } from "./saTestHarness";

let h: ReturnType<typeof tokenHarness>;
let allowlist: string | undefined;
beforeEach(() => {
  allowlist = process.env.ORNN_URL_ALLOWLIST_CIDR;
  process.env.ORNN_URL_ALLOWLIST_CIDR = "127.0.0.1";
  h = tokenHarness();
});
afterEach(() => {
  h.close();
  if (allowlist === undefined) delete process.env.ORNN_URL_ALLOWLIST_CIDR;
  else process.env.ORNN_URL_ALLOWLIST_CIDR = allowlist;
});

async function setup() {
  const rows = new Map<string, StoredSection>();
  const repo = {
    failWrite: false,
    async getSection(id: string) { return rows.get(id) ?? null; },
    async putSection(id: string, value: unknown, updatedBy: string) {
      if (this.failWrite) throw new Error("Database unavailable");
      rows.set(id, { _id: id, value, updatedAt: new Date(), updatedBy });
    },
  };
  const settings = new SettingsServiceImpl({
    repo: repo as unknown as SettingsRepository,
    encryptionKey: crypto.randomUUID(),
  });
  const initial = {
    ...h.credentials, baseApiUrl: h.base, chronoStorageUrl: h.base,
    chronoStorageBucket: "skills", chronoSandboxUrl: h.base,
  };
  await settings.putSection("nyxid", initial, { userId: "admin", email: "admin@example.com", displayName: "Admin" });
  const integration = createNyxidIntegration(settings);
  const client = new StorageClient({
    resolver: async () => {
      const config = await settings.getNyxid();
      return { baseUrl: config.chronoStorageUrl, bucket: config.chronoStorageBucket };
    },
    saTokenProvider: integration.saTokenProvider,
  });
  let admin = true;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, { userId: "admin", permissions: admin ? ["ornn:admin:skill"] : [] } as never);
    await next();
  });
  app.route("/api/v1", createSettingsRoutes({ settingsService: settings }));
  app.onError((err, c) => c.json({ error: "settings save failed" }, (err as { statusCode?: number }).statusCode as 400 ?? 500));
  const put = (value: unknown) => app.request("/api/v1/admin/settings/integrations/nyxid", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  return { ...integration, settings, repo, initial, put, rows,
    setAdmin(value: boolean) { admin = value; },
    upload: () => client.upload("skills", "skill.zip", new Uint8Array([255, 0, 42]), "application/zip"),
  };
}

describe("NyxID settings lifecycle used by bootstrap (#1265)", () => {
  it("applies saved credentials, token endpoint, storage URL and catalog config without restarting", async () => {
    const s = await setup();
    const old = await s.saTokenProvider.getAccessToken();
    h.setDownstream((req) => new URL(req.url).pathname.endsWith("/services")
      ? Response.json([{ id: "before", slug: "before" }]) : Response.json({ data: { url: "uploaded" } }));
    expect(await s.nyxidServiceClient.listActiveServiceIdsAsPlatform(old)).toEqual(new Set(["before"]));
    await s.nyxidServiceClient.listServicesForCaller("user-token");
    const updated = { ...s.initial, tokenUrl: `${h.base}/next/token`, clientId: crypto.randomUUID(), clientSecret: crypto.randomUUID(), chronoStorageUrl: `${h.base}/next`, baseApiUrl: `${h.base}/next` };
    expect((await s.put(updated)).status).toBe(200);
    const paths: string[] = [];
    h.setDownstream((req) => {
      paths.push(new URL(req.url).pathname);
      if (req.headers.get("authorization") === `Bearer ${old}`) return new Response(null, { status: 401 });
      return new URL(req.url).pathname.endsWith("/services")
        ? Response.json([{ id: "after", slug: "after" }]) : Response.json({ data: { url: "uploaded" } });
    });
    expect(await s.upload()).toEqual({ url: "uploaded" });
    expect(h.mintCount).toBe(2);
    expect(h.mintBodies[1]?.get("client_id")).toBe(updated.clientId);
    expect(h.mintBodies[1]?.get("client_secret")).toBe(updated.clientSecret);
    expect(await s.nyxidServiceClient.listActiveServiceIdsAsPlatform(await s.saTokenProvider.getAccessToken())).toEqual(new Set(["after"]));
    expect((await s.nyxidServiceClient.listServicesForCaller("user-token"))[0]?.id).toBe("after");
    expect(paths).toEqual(["/next/api/buckets/skills/objects", "/next/api/v1/services", "/next/api/v1/services"]);
  });

  it.each(["success", "failure"])("fences an old in-flight acquisition completing with %s after PUT", async (outcome) => {
    const s = await setup();
    const started = deferred<void>();
    const release = deferred<Response>();
    const oldToken = crypto.randomUUID();
    const newToken = crypto.randomUUID();
    h.setMint(() => { started.resolve(); return release.promise; });
    const acquisition = s.saTokenProvider.getAccessToken();
    await started.promise;
    expect((await s.put({ ...s.initial, clientSecret: crypto.randomUUID() })).status).toBe(200);
    h.setMint(() => Response.json({ access_token: newToken }));
    expect(await s.saTokenProvider.getAccessToken()).toBe(newToken);
    release.resolve(outcome === "success" ? Response.json({ access_token: oldToken }) : new Response(null, { status: 401 }));
    expect(await acquisition).toBe(newToken);
    expect(await s.saTokenProvider.getAccessToken()).toBe(newToken);
    expect(h.mintCount).toBe(2);
  });

  it.each(["persist", "validation", "permission"])("does not invalidate credentials on a failed %s PUT", async (failure) => {
    const s = await setup();
    const old = await s.saTokenProvider.getAccessToken();
    s.repo.failWrite = failure === "persist";
    s.setAdmin(failure !== "permission");
    const result = await s.put({ ...s.initial, clientSecret: crypto.randomUUID(), tokenUrl: failure === "validation" ? "not a URL" : `${h.base}/next/token` });
    expect(result.status).toBe(failure === "persist" ? 500 : failure === "validation" ? 400 : 403);
    expect(await s.saTokenProvider.getAccessToken()).toBe(old);
    expect(await s.settings.getNyxid()).toEqual(s.initial);
    expect(h.mintCount).toBe(1);
  });

  it("does not let an old config read repopulate the cache after a successful save", async () => {
    const s = await setup();
    const previous = s.rows.get("nyxid")!;
    const pending = deferred<StoredSection | null>();
    const original = s.repo.getSection.bind(s.repo);
    let reads = 0;
    s.repo.getSection = async (id) => ++reads === 1 ? pending.promise : original(id);
    s.settings.invalidateCache();
    const oldRead = s.settings.getNyxid();
    const updated = { ...s.initial, clientSecret: crypto.randomUUID() };
    expect((await s.put(updated)).status).toBe(200);
    pending.resolve(previous);
    expect(await oldRead).toEqual(updated);
    expect(await s.settings.getNyxid()).toEqual(updated);
  });

  it("re-resolves cached settings when a revoked token receives 401", async () => {
    const s = await setup();
    const old = await s.saTokenProvider.getAccessToken();
    // A write from another process is normally hidden behind the local config TTL.
    // Keep the encrypted secret intact while changing a non-secret target.
    const row = s.rows.get("nyxid")!;
    s.rows.set("nyxid", { ...row, value: { ...row.value as object, chronoStorageUrl: `${h.base}/next` } });
    const paths: string[] = [];
    h.setDownstream((req) => {
      paths.push(new URL(req.url).pathname);
      return req.headers.get("authorization") === `Bearer ${old}`
        ? new Response(null, { status: 401 }) : Response.json({ data: { url: "uploaded" } });
    });
    await s.upload();
    expect(paths).toEqual(["/api/buckets/skills/objects", "/next/api/buckets/skills/objects"]);
    expect(h.mintCount).toBe(2);
  });

  it("leaves the SA token intact when another settings section is saved", async () => {
    const s = await setup();
    const old = await s.saTokenProvider.getAccessToken();
    await s.settings.putSection("playground", await s.settings.getPlayground(), { userId: "admin", email: "admin@example.com", displayName: "Admin" });
    expect(await s.saTokenProvider.getAccessToken()).toBe(old);
    expect(h.mintCount).toBe(1);
  });
});
