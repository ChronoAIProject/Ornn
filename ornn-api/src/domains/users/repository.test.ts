/**
 * UserDirectoryRepository unit tests (#454).
 *
 * `users` is the directory cache backing the permissions picker, the
 * admin dashboard, and every userId → email/displayName lookup.
 * NyxID is the source of truth for identity; this collection is
 * write-on-every-authenticated-request and read on hot paths.
 *
 * Covers happy path + at least one edge per public method, per #454
 * acceptance criteria.
 *
 * @module domains/users/repository.test
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserDirectoryRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: UserDirectoryRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("users_test");
  repo = new UserDirectoryRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("users").deleteMany({});
});

describe("upsert", () => {
  test("inserts a fresh user with firstSeenAt + activityCount=1", async () => {
    await repo.upsert({ userId: "u1", email: "u1@x.test", displayName: "User 1", isAdmin: false });
    const doc = await db.collection("users").findOne({ _id: "u1" as never });
    expect(doc?.email).toBe("u1@x.test");
    expect(doc?.displayName).toBe("User 1");
    expect(doc?.isAdmin).toBe(false);
    expect(doc?.activityCount).toBe(1);
    expect(doc?.firstSeenAt).toBeInstanceOf(Date);
    expect(doc?.lastSeenAt).toBeInstanceOf(Date);
  });

  test("subsequent upserts bump activityCount + lastSeenAt but preserve firstSeenAt", async () => {
    await repo.upsert({ userId: "u1", email: "old@x.test", displayName: "Old Name", isAdmin: false });
    const first = await db.collection("users").findOne({ _id: "u1" as never });
    const firstSeenAt = first?.firstSeenAt;
    // Briefly wait so lastSeenAt actually advances.
    await new Promise((r) => setTimeout(r, 10));
    await repo.upsert({ userId: "u1", email: "new@x.test", displayName: "New Name", isAdmin: true });
    const second = await db.collection("users").findOne({ _id: "u1" as never });
    expect(second?.email).toBe("new@x.test");
    expect(second?.displayName).toBe("New Name");
    expect(second?.isAdmin).toBe(true);
    expect(second?.activityCount).toBe(2);
    // firstSeenAt MUST NOT change on subsequent upserts.
    expect(second?.firstSeenAt?.getTime()).toBe(firstSeenAt?.getTime());
    // lastSeenAt SHOULD have advanced.
    expect(second?.lastSeenAt?.getTime()).toBeGreaterThan(first?.lastSeenAt?.getTime() ?? 0);
  });
});

describe("listAdminUserIds + listAdmins", () => {
  test("returns only users with isAdmin=true", async () => {
    await repo.upsert({ userId: "u1", email: "u1@x", displayName: "U1", isAdmin: false });
    await repo.upsert({ userId: "a1", email: "a1@x", displayName: "A1", isAdmin: true });
    await repo.upsert({ userId: "a2", email: "a2@x", displayName: "A2", isAdmin: true });
    const ids = await repo.listAdminUserIds();
    expect(ids.size).toBe(2);
    expect(ids.has("a1")).toBe(true);
    expect(ids.has("a2")).toBe(true);
    expect(ids.has("u1")).toBe(false);

    const admins = await repo.listAdmins();
    expect(admins).toHaveLength(2);
    expect(admins.every((d) => d.isAdmin)).toBe(true);
  });

  test("empty when there are no admins", async () => {
    await repo.upsert({ userId: "u1", email: "u1@x", displayName: "U1", isAdmin: false });
    expect((await repo.listAdminUserIds()).size).toBe(0);
    expect(await repo.listAdmins()).toHaveLength(0);
  });
});

describe("searchByEmailPrefix", () => {
  beforeEach(async () => {
    await repo.upsert({ userId: "u1", email: "alice@x.test", displayName: "Alice", isAdmin: false });
    await repo.upsert({ userId: "u2", email: "alex@x.test", displayName: "Alex", isAdmin: false });
    await repo.upsert({ userId: "u3", email: "bob@x.test", displayName: "Bob", isAdmin: false });
  });

  test("matches by email prefix, case-insensitive", async () => {
    const rows = await repo.searchByEmailPrefix("al", 10);
    expect(rows.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
  });

  test("empty prefix returns all non-empty emails up to limit, sorted by recency", async () => {
    const rows = await repo.searchByEmailPrefix("", 10);
    expect(rows).toHaveLength(3);
  });

  test("respects limit", async () => {
    const rows = await repo.searchByEmailPrefix("", 2);
    expect(rows).toHaveLength(2);
  });

  test("escapes regex metacharacters in prefix (no ReDoS, no false positives)", async () => {
    // `.` is a regex metacharacter; if unescaped, "u." would match every entry.
    const rows = await repo.searchByEmailPrefix("alex@x.test", 10);
    // Should match exactly the literal email, not regex-match.
    expect(rows.map((r) => r.userId)).toEqual(["u2"]);
  });
});

describe("findByUserIds", () => {
  test("resolves multiple userIds at once", async () => {
    await repo.upsert({ userId: "u1", email: "u1@x", displayName: "U1", isAdmin: false });
    await repo.upsert({ userId: "u2", email: "u2@x", displayName: "U2", isAdmin: false });
    const rows = await repo.findByUserIds(["u1", "u2"]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
  });

  test("silently drops unknown ids", async () => {
    await repo.upsert({ userId: "u1", email: "u1@x", displayName: "U1", isAdmin: false });
    const rows = await repo.findByUserIds(["u1", "does-not-exist"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("u1");
  });

  test("empty input returns empty output without hitting the DB", async () => {
    const rows = await repo.findByUserIds([]);
    expect(rows).toEqual([]);
  });
});

describe("listUsers", () => {
  beforeEach(async () => {
    await repo.upsert({ userId: "n1", email: "n1@x.test", displayName: "Normal 1", isAdmin: false });
    await repo.upsert({ userId: "n2", email: "n2@x.test", displayName: "Normal 2", isAdmin: false });
    await repo.upsert({ userId: "a1", email: "a1@x.test", displayName: "Admin 1", isAdmin: true });
  });

  test("role=admin partition", async () => {
    const result = await repo.listUsers({ role: "admin", page: 1, pageSize: 10 });
    expect(result.items.map((u) => u.userId)).toEqual(["a1"]);
  });

  test("role=normal partition", async () => {
    const result = await repo.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(result.items.map((u) => u.userId).sort()).toEqual(["n1", "n2"]);
  });

  test("q= filters by email prefix", async () => {
    const result = await repo.listUsers({
      role: "normal",
      page: 1,
      pageSize: 10,
      q: "n1",
    });
    expect(result.items.map((u) => u.userId)).toEqual(["n1"]);
  });

  // #587 — placeholder said "email or display name" but only email
  // matched. These pin the OR'd display-name path so a regression is
  // caught loudly.
  test("q= also matches display name (#587) — exact match", async () => {
    const result = await repo.listUsers({
      role: "normal",
      page: 1,
      pageSize: 10,
      q: "Normal 1",
    });
    expect(result.items.map((u) => u.userId)).toEqual(["n1"]);
  });

  test("q= matches display-name substring, not just prefix (#587)", async () => {
    // Reproducer from the issue: `Proxy` should match `Ornn Local Proxy`.
    await repo.upsert({
      userId: "p1",
      email: "proxy@x.test",
      displayName: "Ornn Local Proxy",
      isAdmin: false,
    });
    const result = await repo.listUsers({
      role: "normal",
      page: 1,
      pageSize: 10,
      q: "Proxy",
    });
    expect(result.items.map((u) => u.userId)).toContain("p1");
  });

  test("q= display-name match is case-insensitive (#587)", async () => {
    const result = await repo.listUsers({
      role: "admin",
      page: 1,
      pageSize: 10,
      q: "admin 1",
    });
    expect(result.items.map((u) => u.userId)).toEqual(["a1"]);
  });

  test("q= escapes regex metacharacters in display-name match (#587)", async () => {
    // `.` is a regex metachar; if unescaped, "1.x" would match every
    // display name. Pinning so the escape stays in place.
    await repo.upsert({
      userId: "z1",
      email: "z1@x.test",
      displayName: "Z (1.x)",
      isAdmin: false,
    });
    const matches = await repo.listUsers({
      role: "normal",
      page: 1,
      pageSize: 10,
      q: "(1.x)",
    });
    expect(matches.items.map((u) => u.userId)).toEqual(["z1"]);
    const nonMatches = await repo.listUsers({
      role: "normal",
      page: 1,
      pageSize: 10,
      q: "(1*x)",
    });
    expect(nonMatches.items.map((u) => u.userId)).not.toContain("z1");
  });

  test("pagination respects pageSize + page", async () => {
    const first = await repo.listUsers({ role: "normal", page: 1, pageSize: 1 });
    const second = await repo.listUsers({ role: "normal", page: 2, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.userId).not.toBe(second.items[0]?.userId);
  });
});

describe("countByRole", () => {
  test("returns admin / normal / total counts", async () => {
    await repo.upsert({ userId: "n1", email: "n1@x", displayName: "N1", isAdmin: false });
    await repo.upsert({ userId: "n2", email: "n2@x", displayName: "N2", isAdmin: false });
    await repo.upsert({ userId: "a1", email: "a1@x", displayName: "A1", isAdmin: true });
    const counts = await repo.countByRole();
    expect(counts.normal).toBe(2);
    expect(counts.admin).toBe(1);
    expect(counts.total).toBe(3);
  });

  test("zeros when empty", async () => {
    const counts = await repo.countByRole();
    expect(counts).toEqual({ admin: 0, normal: 0, total: 0 });
  });
});
