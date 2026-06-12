/**
 * Admin platform-settings routes — mount + dispatch tests (#877).
 *
 * Pure dependency-injected fake `PlatformSettingsService` — NO MongoDB.
 * The route layer is the unit under test: response masking, the
 * field-by-field PATCH validation gauntlet, and the "preserve existing"
 * semantics around the mid-mask sentinel.
 *
 * Harness mirrors `domains/admin/quota/routes.test.ts`: synthetic auth
 * middleware reading `x-test-perms`, an `onError` rendering RFC 7807
 * problem+json via `buildProblemJsonBody`, and `app.request()` dispatch.
 *
 * Secret-leak guard: every assertion on a settings body verifies the
 * plaintext apiKey is ABSENT and only the bullet-masked form is present.
 *
 * @module domains/platform/routes.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { midMaskSecret } from "../../infra/crypto";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createPlatformSettingsRoutes } from "./routes";
import type { PlatformSettingsService } from "./service";
import type { LlmProviderConfig, PlatformSettings } from "./types";

const ADMIN_PERM = "ornn:admin:skill";
/** A real, never-masked plaintext key — its raw form must never appear in a body. */
const PLAINTEXT_KEY = "sk-live-deadbeefcafef00d-secret";
const STORED_GATEWAY = "https://gw.stored.test";

/** Recorded patches the route handed to the service. */
let patchCalls: Array<Partial<PlatformSettings>>;
/** Number of times the preserve path consulted the existing config. */
let getLlmConfigCalls: number;
/** What the fake `getLlmProviderConfig` returns (the stored shape). */
let storedLlmConfig: LlmProviderConfig;
/** What the fake `patch` returns (echoes the patch merged over a base). */
let app: Hono<{ Variables: AuthVariables }>;

/**
 * Throwing proxy DI fake — only `get`, `patch`, `getLlmProviderConfig`
 * are legitimately used by the route. Any other access is a bug.
 */
function makeService(): PlatformSettingsService {
  const impl: Partial<PlatformSettingsService> = {
    async get(): Promise<PlatformSettings> {
      return {
        auditWaiverThreshold: 6,
        llmProvider: { gatewayUrl: STORED_GATEWAY, apiKey: PLAINTEXT_KEY },
      };
    },
    async getLlmProviderConfig(): Promise<LlmProviderConfig> {
      getLlmConfigCalls += 1;
      return storedLlmConfig;
    },
    async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
      patchCalls.push(partial);
      return {
        auditWaiverThreshold: partial.auditWaiverThreshold ?? 6,
        llmProvider: partial.llmProvider ?? {
          gatewayUrl: STORED_GATEWAY,
          apiKey: PLAINTEXT_KEY,
        },
      };
    },
  };
  return new Proxy(impl as PlatformSettingsService, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`platformSettingsService.${String(prop)} accessed but not faked`);
    },
  });
}

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "x-test-perms": perms.join(",") };
}

function jsonHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "content-type": "application/json", ...authHeaders(perms) };
}

beforeEach(() => {
  patchCalls = [];
  getLlmConfigCalls = 0;
  storedLlmConfig = { gatewayUrl: STORED_GATEWAY, apiKey: PLAINTEXT_KEY };

  const router = createPlatformSettingsRoutes({ platformSettingsService: makeService() });
  app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    const permsHeader = c.req.header("x-test-perms") ?? "";
    const permissions = permsHeader.length > 0 ? permsHeader.split(",") : [];
    c.set("auth", {
      userId: "admin1",
      email: "admin@x.test",
      displayName: "Admin",
      roles: [],
      permissions,
    });
    await next();
  });
  app.onError((err, c) => {
    const e = err as { statusCode?: number; code?: string; message: string };
    const statusCode = e.statusCode ?? 500;
    const code = e.code ?? "internal_error";
    const body = buildProblemJsonBody({
      statusCode,
      code,
      message: e.message ?? "",
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, statusCode as never, {
      "Content-Type": "application/problem+json",
    });
  });
  app.route("/", router);
});

describe("GET /admin/settings", () => {
  test("200 masks apiKey — plaintext absent, mid-mask present", async () => {
    const res = await app.request("/admin/settings", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const raw = await res.text();
    // Hard secret-leak guard: the plaintext key must never appear anywhere.
    expect(raw).not.toContain(PLAINTEXT_KEY);
    const json = JSON.parse(raw) as {
      data: { llmProvider: { gatewayUrl: string; apiKey: string } };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data.llmProvider.gatewayUrl).toBe(STORED_GATEWAY);
    expect(json.data.llmProvider.apiKey).toBe(midMaskSecret(PLAINTEXT_KEY));
    expect(json.data.llmProvider.apiKey).toContain("•");
    expect(json.data.llmProvider.apiKey).not.toBe(PLAINTEXT_KEY);
  });

  test("403 when admin perm missing", async () => {
    const res = await app.request("/admin/settings", { headers: authHeaders([]) });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /admin/settings — validation", () => {
  test("non-object body → 400 invalid_body", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(["not", "an", "object"]),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_body");
    expect(patchCalls.length).toBe(0);
  });

  test("auditWaiverThreshold out of [0,10] → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ auditWaiverThreshold: 11 }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  // Lower-bound boundary: the guard rejects `n < 0` before rounding/persisting.
  test("auditWaiverThreshold negative (-1) → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ auditWaiverThreshold: -1 }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  // Non-numeric input: Number("x") is NaN, so the `!Number.isFinite(n)` arm of
  // the same guard fires → 400 invalid_setting (route never coerces it to 0).
  test("auditWaiverThreshold non-number ('x') → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ auditWaiverThreshold: "x" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  test("auditWaiverThreshold rounds to 1 decimal place", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ auditWaiverThreshold: 6.789 }),
    });
    expect(res.status).toBe(200);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]!.auditWaiverThreshold).toBe(6.8); // Math.round(6.789*10)/10
  });

  test("llmProvider non-object → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: "not-an-object" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  test("llmProvider.gatewayUrl non-string → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: { gatewayUrl: 123 } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  test("llmProvider.gatewayUrl invalid URL → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: { gatewayUrl: "not a url" } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });

  test("empty patch (no known keys) → 400 invalid_setting", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ unknownKey: "ignored" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_setting");
    expect(patchCalls.length).toBe(0);
  });
});

describe("PATCH /admin/settings — preserve semantics", () => {
  test("gatewayUrl omitted → existing consulted + preserved in patch", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: { apiKey: "" } }),
    });
    expect(res.status).toBe(200);
    expect(getLlmConfigCalls).toBeGreaterThanOrEqual(1);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]!.llmProvider!.gatewayUrl).toBe(STORED_GATEWAY);
  });

  test("apiKey mid-mask sentinel → stored key preserved (not bullets)", async () => {
    const masked = midMaskSecret(PLAINTEXT_KEY); // contains the bullet sentinel
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: { gatewayUrl: "https://gw.new.test", apiKey: masked } }),
    });
    expect(res.status).toBe(200);
    expect(patchCalls).toHaveLength(1);
    // The sentinel must resolve to the stored key, NOT the bullet string.
    expect(patchCalls[0]!.llmProvider!.apiKey).toBe(PLAINTEXT_KEY);
    expect(patchCalls[0]!.llmProvider!.apiKey).not.toContain("•");
    expect(patchCalls[0]!.llmProvider!.gatewayUrl).toBe("https://gw.new.test");
    // Response is re-masked — plaintext never leaks back out.
    const raw = await res.text();
    expect(raw).not.toContain(PLAINTEXT_KEY);
  });

  test("apiKey omitted → stored key preserved via getLlmProviderConfig", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ llmProvider: { gatewayUrl: "https://gw.new.test" } }),
    });
    expect(res.status).toBe(200);
    expect(getLlmConfigCalls).toBeGreaterThanOrEqual(1);
    expect(patchCalls[0]!.llmProvider!.apiKey).toBe(PLAINTEXT_KEY);
  });

  test("real apiKey → trimmed + stored verbatim", async () => {
    const res = await app.request("/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        llmProvider: { gatewayUrl: "https://gw.new.test", apiKey: `  ${PLAINTEXT_KEY}  ` },
      }),
    });
    expect(res.status).toBe(200);
    expect(patchCalls[0]!.llmProvider!.apiKey).toBe(PLAINTEXT_KEY); // trimmed
    // The response body re-masks the just-set key.
    const raw = await res.text();
    expect(raw).not.toContain(PLAINTEXT_KEY);
    const json = JSON.parse(raw) as { data: { llmProvider: { apiKey: string } } };
    expect(json.data.llmProvider.apiKey).toContain("•");
  });
});
