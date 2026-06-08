/**
 * Notification HTTP route tests.
 *
 * Mounts `createNotificationRoutes` on a real Hono app — with the same
 * auth-injecting middleware + RFC 7807 `onError` handler the live
 * bootstrap wires — and dispatches via `app.request()`. The
 * NotificationService is replaced by a throwing-proxy fake: any method
 * the route layer touches that a given test didn't explicitly stub
 * throws, so the test pins exactly which service calls each handler
 * makes and nothing leaks through unnoticed.
 *
 * Coverage targets the route module's own logic:
 *   - all four handlers (feed, unread-count, mark one read, mark-all-read);
 *   - `toFeedDto` for BOTH variants — the user variant with and without
 *     the optional `body` / `link` (the exactOptionalPropertyTypes
 *     conditional spread, #657) and the broadcast variant;
 *   - the `?unread=true` discriminator and `?limit=` parsing: the
 *     route forwards the parsed value RAW to the service (no clamp —
 *     the service owns the clamp authority, #920), and drops a
 *     malformed/empty `?limit=` to `undefined` so the service falls
 *     back to its default page size;
 *   - the `{ data, error: null }` success envelope (CONVENTIONS);
 *   - markRead of an unknown id → service throws AppError.notFound →
 *     404 application/problem+json.
 *
 * @module domains/notifications/routes.test
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { AppError, buildProblemJsonBody } from "../../shared/types/index";
import type { ListOptions, NotificationRepository } from "./repository";
import { createNotificationRoutes } from "./routes";
import { NotificationService } from "./service";
import type { FeedItem, NotificationDocument } from "./types";

const USER_ID = "u-router";

/**
 * Build a NotificationService stub from a partial set of overrides.
 * Every method not provided throws when called, so each test asserts
 * exactly which service methods the handler under test reaches.
 */
function fakeService(
  overrides: Partial<Record<keyof NotificationService, unknown>>,
): NotificationService {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop in overrides) {
          return (overrides as Record<string | symbol, unknown>)[prop];
        }
        return () => {
          throw new Error(`unexpected NotificationService.${String(prop)} call`);
        };
      },
    },
  ) as unknown as NotificationService;
}

/**
 * Mount the routes with a fixed-identity auth middleware and the live
 * problem+json error handler so 4xx responses match the wire contract.
 */
function mountApp(service: NotificationService): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      userId: USER_ID,
      email: "router@x.test",
      displayName: "Router",
      roles: [],
      permissions: [],
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
  app.route("/", createNotificationRoutes({ notificationService: service }));
  return app;
}

function userFeedItem(overrides: Partial<Extract<FeedItem, { source: "user" }>>): FeedItem {
  return {
    _id: "n-1",
    source: "user",
    userId: USER_ID,
    category: "audit.completed",
    title: "Audit passed",
    data: { skillGuid: "abc" },
    readAt: null,
    createdAt: new Date("2026-05-10T00:00:00Z"),
    ...overrides,
  };
}

function broadcastFeedItem(
  overrides: Partial<Extract<FeedItem, { source: "broadcast" }>>,
): FeedItem {
  return {
    _id: "b-1",
    source: "broadcast",
    titleI18n: { en: "Heads up", zh: "注意" },
    bodyMarkdownI18n: { en: "**Body**", zh: "**内容**" },
    createdAt: new Date("2026-05-09T00:00:00Z"),
    readAt: null,
    ...overrides,
  };
}

describe("notification routes — GET /notifications", () => {
  test("returns the merged feed in the { data, error: null } envelope", async () => {
    const app = mountApp(
      fakeService({
        listFeedForUser: async () => [userFeedItem({})],
      }),
    );
    const res = await app.request("/notifications");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] }; error: null };
    expect(body.error).toBeNull();
    expect(body.data.items).toHaveLength(1);
  });

  test("toFeedDto — user variant WITH body + link serializes both", async () => {
    const app = mountApp(
      fakeService({
        listFeedForUser: async () =>
          [
            userFeedItem({
              _id: "n-full",
              body: "Audit verdict was green.",
              link: "/skills/abc/audits?version=1.0.0",
            }),
          ] as FeedItem[],
      }),
    );
    const res = await app.request("/notifications");
    const body = (await res.json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const dto = body.data.items[0]!;
    expect(dto.source).toBe("user");
    expect(dto._id).toBe("n-full");
    expect(dto.body).toBe("Audit verdict was green.");
    expect(dto.link).toBe("/skills/abc/audits?version=1.0.0");
    expect(dto.createdAt).toBe("2026-05-10T00:00:00.000Z");
    expect(dto.readAt).toBeNull();
  });

  test("toFeedDto — user variant WITHOUT body/link omits both keys (#657 spread)", async () => {
    const app = mountApp(
      fakeService({
        listFeedForUser: async () =>
          [userFeedItem({ _id: "n-bare", readAt: new Date("2026-05-11T00:00:00Z") })] as FeedItem[],
      }),
    );
    const res = await app.request("/notifications");
    const body = (await res.json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const dto = body.data.items[0]!;
    // The conditional spread must NOT materialise undefined-valued keys.
    expect("body" in dto).toBe(false);
    expect("link" in dto).toBe(false);
    expect(dto.readAt).toBe("2026-05-11T00:00:00.000Z");
  });

  test("toFeedDto — broadcast variant carries titleI18n + bodyMarkdownI18n", async () => {
    const app = mountApp(
      fakeService({
        listFeedForUser: async () =>
          [broadcastFeedItem({ readAt: new Date("2026-05-12T00:00:00Z") })] as FeedItem[],
      }),
    );
    const res = await app.request("/notifications");
    const body = (await res.json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const dto = body.data.items[0]!;
    expect(dto.source).toBe("broadcast");
    expect(dto.titleI18n).toEqual({ en: "Heads up", zh: "注意" });
    expect(dto.bodyMarkdownI18n).toEqual({ en: "**Body**", zh: "**内容**" });
    expect(dto.createdAt).toBe("2026-05-09T00:00:00.000Z");
    expect(dto.readAt).toBe("2026-05-12T00:00:00.000Z");
  });

  test("?unread=true forwards unreadOnly: true to the service", async () => {
    let received: { unreadOnly?: boolean; limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    await app.request("/notifications?unread=true");
    expect(received?.unreadOnly).toBe(true);
  });

  // The route NO LONGER clamps (#920) — it forwards the parsed value
  // raw and lets the service apply the floor/ceiling. These assertions
  // pin the forwarding contract, not the clamp.
  test("?limit=0 forwards 0 raw (service clamps, not the route)", async () => {
    let received: { limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    await app.request("/notifications?limit=0");
    expect(received?.limit).toBe(0);
  });

  test("?limit in range forwards the value unchanged", async () => {
    let received: { limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    await app.request("/notifications?limit=25");
    expect(received?.limit).toBe(25);
  });

  test("?limit above the ceiling forwards 9999 raw (service clamps)", async () => {
    let received: { limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    await app.request("/notifications?limit=9999");
    expect(received?.limit).toBe(9999);
  });

  test("?limit=abc (malformed) → 200 + limit undefined (service defaults) (#920)", async () => {
    let received: { limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    const res = await app.request("/notifications?limit=abc");
    expect(res.status).toBe(200);
    expect(received?.limit).toBeUndefined();
  });

  test("?limit= (empty) → 200 + limit undefined (service defaults) (#920)", async () => {
    let received: { limit?: number } | undefined;
    const app = mountApp(
      fakeService({
        listFeedForUser: async (_userId: string, opts: typeof received) => {
          received = opts;
          return [];
        },
      }),
    );
    const res = await app.request("/notifications?limit=");
    expect(res.status).toBe(200);
    expect(received?.limit).toBeUndefined();
  });
});

describe("notification routes — GET /notifications/unread-count", () => {
  test("returns the count in the envelope", async () => {
    const app = mountApp(
      fakeService({
        countUnread: async () => 7,
      }),
    );
    const res = await app.request("/notifications/unread-count");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { count: number }; error: null };
    expect(body.data.count).toBe(7);
    expect(body.error).toBeNull();
  });
});

describe("notification routes — POST /notifications/:id/read", () => {
  test("returns the updated record in the envelope", async () => {
    const updated = { source: "broadcast" as const, readAt: new Date("2026-05-13T00:00:00Z") };
    const app = mountApp(
      fakeService({
        markRead: async () => updated,
      }),
    );
    const res = await app.request("/notifications/b-1/read", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { source: string }; error: null };
    expect(body.data.source).toBe("broadcast");
    expect(body.error).toBeNull();
  });

  test("unknown id → service throws AppError.notFound → 404 problem+json", async () => {
    const app = mountApp(
      fakeService({
        markRead: async () => {
          throw AppError.notFound("notification_not_found", "Notification not found");
        },
      }),
    );
    const res = await app.request("/notifications/nope/read", { method: "POST" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/problem+json");
    const body = (await res.json()) as {
      status: number;
      code: string;
      detail: string;
      instance: string;
    };
    expect(body.status).toBe(404);
    expect(body.code).toBe("notification_not_found");
    expect(body.detail).toBe("Notification not found");
    expect(body.instance).toBe("/notifications/nope/read");
  });
});

describe("notification routes — POST /notifications/mark-all-read", () => {
  test("returns the transition count in the envelope", async () => {
    const app = mountApp(
      fakeService({
        markAllRead: async () => 4,
      }),
    );
    const res = await app.request("/notifications/mark-all-read", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { updated: number }; error: null };
    expect(body.data.updated).toBe(4);
    expect(body.error).toBeNull();
  });
});

/**
 * Wired end-to-end seam: HTTP route → REAL NotificationService → fake
 * repo (#920). Every other test in this file stubs the service with a
 * Proxy, so they pin only what the *route* forwards (`?limit=0` → raw
 * 0, malformed → undefined) and the clamp lives unverified across the
 * seam. The clamp itself is covered in service.test.ts at the service
 * boundary. Neither side proves the *composition*: that the route's raw
 * forward + the service's clamp actually meet on one request. These
 * tests mount the route over a genuine `NotificationService` backed by
 * a minimal repo that captures the `limit` the service ultimately hands
 * the repo — pinning that `GET /notifications?limit=<x>` lands the
 * expected clamped value at the persistence boundary, in one path.
 *
 * The fake repo only implements `list` (the sole method this seam
 * touches) + captures `lastListOptions`; the rest throw if reached so
 * the assertions stay honest about which repo calls the handler makes.
 */
class CapturingNotificationRepo {
  /** Captures the `list` options the service forwards, so the seam test
   *  can read the clamped `limit` at the persistence boundary. */
  lastListOptions: ListOptions | undefined;

  async list(_userId: string, options: ListOptions = {}): Promise<NotificationDocument[]> {
    this.lastListOptions = options;
    return [];
  }

  async create(): Promise<NotificationDocument> {
    throw new Error("unexpected NotificationRepository.create call");
  }

  async countUnread(): Promise<number> {
    throw new Error("unexpected NotificationRepository.countUnread call");
  }

  async markRead(): Promise<NotificationDocument | null> {
    throw new Error("unexpected NotificationRepository.markRead call");
  }

  async markAllRead(): Promise<number> {
    throw new Error("unexpected NotificationRepository.markAllRead call");
  }
}

describe("notification routes — wired clamp seam (route → service → repo) (#920)", () => {
  // Mirror the (unexported) service constant so the assertion reads
  // intent-first. Keep in sync with service.ts MERGED_FEED_LIMIT_DEFAULT.
  const MERGED_FEED_LIMIT_DEFAULT = 50;

  function mountWired(): { app: Hono<{ Variables: AuthVariables }>; repo: CapturingNotificationRepo } {
    const repo = new CapturingNotificationRepo();
    // No broadcastRepo — the seam under test is the per-user `list`
    // limit, which the service derives before touching either source.
    const service = new NotificationService({
      notificationRepo: repo as unknown as NotificationRepository,
    });
    return { app: mountApp(service), repo };
  }

  test("?limit=0 → 200 AND repo receives clamped limit 1 (route forwards raw 0, service floors)", async () => {
    const { app, repo } = mountWired();
    const res = await app.request("/notifications?limit=0");
    expect(res.status).toBe(200);
    // Route forwarded raw 0 → service clamped up to the floor (1).
    expect(repo.lastListOptions?.limit).toBe(1);
  });

  test("?limit=-50 → 200 AND repo receives clamped limit 1 (negative-finite floor)", async () => {
    const { app, repo } = mountWired();
    const res = await app.request("/notifications?limit=-50");
    expect(res.status).toBe(200);
    // -50 is finite, so the route forwards it raw; the service floors it.
    expect(repo.lastListOptions?.limit).toBe(1);
  });

  test("?limit=abc → 200 AND repo receives the default page size (route drops NaN → service default)", async () => {
    const { app, repo } = mountWired();
    const res = await app.request("/notifications?limit=abc");
    expect(res.status).toBe(200);
    // Malformed → route drops to undefined → service falls back to default.
    expect(repo.lastListOptions?.limit).toBe(MERGED_FEED_LIMIT_DEFAULT);
  });
});
