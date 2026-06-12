/**
 * Announcement routes tests (#882).
 *
 * Mounts `createAnnouncementRoutes` on a bare Hono app. The public
 * endpoints take no auth; the admin endpoints run through the real
 * `requirePermission("ornn:admin:skill")` gate, toggled per-test via an
 * `x-test-perms` header (harness cloned from `admin/quota/routes.test.ts`).
 * `AnnouncementService` is a throwing Proxy stubbed per-case.
 *
 * Covers:
 *   - public GET `/announcements` + `/announcements/active` (no auth, no
 *     `createdBy` leak in the public shape);
 *   - admin no-permission → 403 on every admin handler;
 *   - POST 201 + Location + `toAdminDto` date serialization on BOTH the
 *     non-null (`.toISOString()`) and null arms;
 *   - `assertCtaPairing`: url-without-label → 400 (path `ctaLabelEn`),
 *     label-without-url → 400 (path `ctaUrl`), both-set pass, both-null
 *     pass;
 *   - PATCH `{}` → 400 `invalid_announcement_input` (the explicit
 *     "no fields to update" guard);
 *   - `ctaLabel*` / `ctaUrl` `?? null` create-call mapping;
 *   - `titleEn` / `titleZh` i18n round-trip through the DTO.
 *
 * @module domains/announcements/routes.test
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createAnnouncementRoutes } from "./routes";
import type { AnnouncementService } from "./service";
import type {
  AnnouncementDocument,
  PublicAnnouncement,
  PublicAnnouncementListItem,
} from "./types";

const ADMIN_PERM = "ornn:admin:skill";

function fakeService(overrides: Partial<AnnouncementService>): AnnouncementService {
  const target = { ...overrides } as Record<string, unknown>;
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      throw new Error(`unexpected AnnouncementService.${String(prop)} call`);
    },
  }) as unknown as AnnouncementService;
}

function buildApp(service: AnnouncementService) {
  const router = createAnnouncementRoutes({ announcementService: service });
  const app = new Hono<{ Variables: AuthVariables }>();
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
    const body = buildProblemJsonBody({
      statusCode,
      code: e.code ?? "internal_error",
      message: e.message ?? "",
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, statusCode as never, {
      "Content-Type": "application/problem+json",
    });
  });
  app.route("/", router);
  return app;
}

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "content-type": "application/json", "x-test-perms": perms.join(",") };
}

function sampleDoc(over: Partial<AnnouncementDocument> = {}): AnnouncementDocument {
  return {
    _id: "a-1",
    titleEn: "Title EN",
    titleZh: "标题中文",
    bodyMarkdownEn: "Body EN",
    bodyMarkdownZh: "正文中文",
    ctaLabelEn: "Learn more",
    ctaLabelZh: "了解更多",
    ctaUrl: "https://example.com",
    enabled: true,
    startsAt: new Date("2026-06-01T00:00:00.000Z"),
    endsAt: new Date("2026-07-01T00:00:00.000Z"),
    createdBy: "admin1",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...over,
  };
}

function samplePublic(): PublicAnnouncement {
  return {
    id: "a-1",
    titleEn: "Title EN",
    titleZh: "标题中文",
    bodyMarkdownEn: "Body EN",
    bodyMarkdownZh: "正文中文",
    ctaLabelEn: "Learn more",
    ctaLabelZh: "了解更多",
    ctaUrl: "https://example.com",
  };
}

/** Minimal valid create body (no CTA → both-null passes the pairing rule). */
const validCreateBody = {
  titleEn: "Title EN",
  titleZh: "标题中文",
  bodyMarkdownEn: "Body EN",
  bodyMarkdownZh: "正文中文",
  enabled: true,
};

describe("public GET /announcements", () => {
  test("returns the list, no auth required, no createdBy leak", async () => {
    const item: PublicAnnouncementListItem = {
      ...samplePublic(),
      publishedAt: "2026-05-01T00:00:00.000Z",
    };
    const app = buildApp(fakeService({ listPublished: async () => [item] }));
    // No x-test-perms header at all — anonymous caller.
    const res = await app.request("/announcements");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: PublicAnnouncementListItem[] };
    };
    expect(json.data.items).toHaveLength(1);
    expect(json.data.items[0]!.publishedAt).toBe("2026-05-01T00:00:00.000Z");
    expect("createdBy" in json.data.items[0]!).toBe(false);
  });
});

describe("public GET /announcements/active", () => {
  test("returns the active announcement under data.active", async () => {
    const app = buildApp(fakeService({ getActive: async () => samplePublic() }));
    const res = await app.request("/announcements/active");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { active: PublicAnnouncement | null } };
    expect(json.data.active?.id).toBe("a-1");
    expect(
      "createdBy" in (json.data.active as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  test("returns null when nothing is active", async () => {
    const app = buildApp(fakeService({ getActive: async () => null }));
    const res = await app.request("/announcements/active");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { active: PublicAnnouncement | null } };
    expect(json.data.active).toBeNull();
  });
});

describe("admin endpoints — permission gate (real requirePermission)", () => {
  test("GET /admin/announcements without perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements", { headers: authHeaders([]) });
    expect(res.status).toBe(403);
  });

  test("POST /admin/announcements without perm → 403, service untouched", async () => {
    let calls = 0;
    const app = buildApp(
      fakeService({
        create: async () => {
          calls++;
          return sampleDoc();
        },
      }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders([]),
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("PATCH without perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements/a-1", {
      method: "PATCH",
      headers: authHeaders([]),
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(403);
  });

  test("DELETE without perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements/a-1", {
      method: "DELETE",
      headers: authHeaders([]),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/announcements", () => {
  test("maps docs through toAdminDto (createdBy + ISO dates present)", async () => {
    const app = buildApp(fakeService({ listAll: async () => [sampleDoc()] }));
    const res = await app.request("/admin/announcements", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const row = json.data.items[0]!;
    expect(row.id).toBe("a-1");
    expect(row.createdBy).toBe("admin1");
    expect(row.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(row.titleEn).toBe("Title EN");
    expect(row.titleZh).toBe("标题中文");
  });
});

describe("POST /admin/announcements", () => {
  test("201 + Location + toAdminDto with non-null dates (.toISOString arm)", async () => {
    let captured: Record<string, unknown> = {};
    const app = buildApp(
      fakeService({
        create: async (input) => {
          captured = input as unknown as Record<string, unknown>;
          return sampleDoc({ _id: "a-new" });
        },
      }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...validCreateBody,
        ctaLabelEn: "Go",
        ctaLabelZh: "走",
        ctaUrl: "https://example.com",
        startsAt: "2026-06-01T00:00:00.000Z",
        endsAt: "2026-07-01T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe("/api/v1/admin/announcements/a-new");
    const json = (await res.json()) as { data: Record<string, unknown> };
    // Non-null window → toISOString arm.
    expect(json.data.startsAt).toBe("2026-06-01T00:00:00.000Z");
    expect(json.data.endsAt).toBe("2026-07-01T00:00:00.000Z");
    // CTA `?? null` mapping forwarded the provided values to the service.
    expect(captured.ctaLabelEn).toBe("Go");
    expect(captured.ctaLabelZh).toBe("走");
    expect(captured.ctaUrl).toBe("https://example.com");
    expect(captured.createdBy).toBe("admin1");
  });

  test("201 + toAdminDto with null dates (null arm) + ctaLabel/ctaUrl ?? null", async () => {
    let captured: Record<string, unknown> = {};
    const app = buildApp(
      fakeService({
        create: async (input) => {
          captured = input as unknown as Record<string, unknown>;
          return sampleDoc({
            _id: "a-null",
            ctaLabelEn: null,
            ctaLabelZh: null,
            ctaUrl: null,
            startsAt: null,
            endsAt: null,
          });
        },
      }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      // No CTA, no window → service receives explicit nulls via `?? null`.
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: Record<string, unknown> };
    // Null window → null arm of the ternary.
    expect(json.data.startsAt).toBeNull();
    expect(json.data.endsAt).toBeNull();
    expect(json.data.ctaLabelEn).toBeNull();
    expect(json.data.ctaUrl).toBeNull();
    // Route's `?? null` mapping turned absent body fields into nulls.
    expect(captured.ctaLabelEn).toBeNull();
    expect(captured.ctaLabelZh).toBeNull();
    expect(captured.ctaUrl).toBeNull();
    expect(captured.startsAt).toBeNull();
    expect(captured.endsAt).toBeNull();
  });

  test("titleEn/titleZh round-trip through the DTO", async () => {
    const app = buildApp(
      fakeService({
        create: async () =>
          sampleDoc({ _id: "a-i18n", titleEn: "Hello", titleZh: "你好" }),
      }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...validCreateBody, titleEn: "Hello", titleZh: "你好" }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { titleEn: string; titleZh: string } };
    expect(json.data.titleEn).toBe("Hello");
    expect(json.data.titleZh).toBe("你好");
  });
});

describe("POST /admin/announcements — assertCtaPairing", () => {
  test("url without label → 400 with path ctaLabelEn", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...validCreateBody, ctaUrl: "https://example.com" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("invalid_announcement_input");
    // The refinement attaches the issue to `ctaLabelEn` when only the url is set.
    expect(body.detail).toContain("ctaLabelEn");
  });

  test("label without url → 400 with path ctaUrl", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...validCreateBody, ctaLabelEn: "Click" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("invalid_announcement_input");
    expect(body.detail).toContain("ctaUrl");
  });

  test("both set → passes the pairing rule", async () => {
    const app = buildApp(
      fakeService({ create: async () => sampleDoc({ _id: "a-pair" }) }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...validCreateBody,
        ctaLabelEn: "Click",
        ctaUrl: "https://example.com",
      }),
    });
    expect(res.status).toBe(201);
  });

  test("both null → passes the pairing rule", async () => {
    const app = buildApp(
      fakeService({ create: async () => sampleDoc({ _id: "a-none" }) }),
    );
    const res = await app.request("/admin/announcements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...validCreateBody, ctaLabelEn: null, ctaUrl: null }),
    });
    expect(res.status).toBe(201);
  });
});

describe("PATCH /admin/announcements/:id", () => {
  test("empty body → 400 invalid_announcement_input", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/announcements/a-1", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_announcement_input");
  });

  test("valid patch → 200 + toAdminDto", async () => {
    let captured: { id?: string; patch?: Record<string, unknown> } = {};
    const app = buildApp(
      fakeService({
        update: async (id, patch) => {
          captured = { id, patch: patch as unknown as Record<string, unknown> };
          return sampleDoc({ enabled: false });
        },
      }),
    );
    const res = await app.request("/admin/announcements/a-1", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(captured.id).toBe("a-1");
    expect(captured.patch!.enabled).toBe(false);
    const json = (await res.json()) as { data: { enabled: boolean } };
    expect(json.data.enabled).toBe(false);
  });
});

describe("DELETE /admin/announcements/:id", () => {
  test("returns { data: { id } }", async () => {
    let deletedId: string | undefined;
    const app = buildApp(
      fakeService({
        delete: async (id) => {
          deletedId = id;
        },
      }),
    );
    const res = await app.request("/admin/announcements/a-9", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe("a-9");
    expect(deletedId).toBe("a-9");
  });
});
