/**
 * Integration tests for the typed-grants boot migration (#1123).
 *
 * Verifies the NON-DISRUPTION invariant end-to-end against a real Mongo:
 * legacy read lists become read-level grants, public/private flags and the
 * legacy lists are preserved, nobody is escalated to write, and reruns are
 * no-ops.
 *
 * @module domains/skills/crud/grants.migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { backfillTypedGrants } from "./grants.migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("grants_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
  await db.collection("skillsets").deleteMany({});
});

describe("backfillTypedGrants", () => {
  it("derives read-level grants from the legacy lists without touching anything else", async () => {
    await db.collection("skills").insertOne({
      _id: "s1" as never,
      name: "legacy-private",
      isPrivate: true,
      sharedWithUsers: ["u1", "u2"],
      sharedWithOrgs: ["o1"],
    });

    const res = await backfillTypedGrants(db);
    expect(res.skillsBackfilled).toBe(1);

    const doc = await db.collection("skills").findOne({ _id: "s1" as never });
    expect(doc?.grants).toEqual([
      { type: "user", id: "u1", level: "read" },
      { type: "user", id: "u2", level: "read" },
      { type: "org", id: "o1", level: "read" },
    ]);
    // Legacy lists + privacy flag preserved (non-disruptive).
    expect(doc?.sharedWithUsers).toEqual(["u1", "u2"]);
    expect(doc?.sharedWithOrgs).toEqual(["o1"]);
    expect(doc?.isPrivate).toBe(true);
    // Nobody escalated to write.
    expect((doc?.grants as Array<{ level: string }>).every((g) => g.level === "read")).toBe(true);
  });

  it("backfills an empty grants array for a public skill with no shares", async () => {
    await db.collection("skills").insertOne({
      _id: "s2" as never,
      name: "public-no-shares",
      isPrivate: false,
      sharedWithUsers: [],
      sharedWithOrgs: [],
    });

    await backfillTypedGrants(db);

    const doc = await db.collection("skills").findOne({ _id: "s2" as never });
    expect(doc?.grants).toEqual([]);
    expect(doc?.isPrivate).toBe(false);
  });

  it("tolerates docs predating even the legacy lists", async () => {
    await db.collection("skills").insertOne({ _id: "s3" as never, name: "ancient" });
    await backfillTypedGrants(db);
    const doc = await db.collection("skills").findOne({ _id: "s3" as never });
    expect(doc?.grants).toEqual([]);
  });

  it("does not touch docs that already carry grants (idempotent)", async () => {
    await db.collection("skills").insertOne({
      _id: "s4" as never,
      name: "already-migrated",
      isPrivate: true,
      sharedWithUsers: ["u1"],
      sharedWithOrgs: [],
      grants: [{ type: "user", id: "u1", level: "read_write" }],
    });

    const res = await backfillTypedGrants(db);
    expect(res.skillsBackfilled).toBe(0);

    const doc = await db.collection("skills").findOne({ _id: "s4" as never });
    // read_write grant preserved — migration must not clobber a richer ACL.
    expect(doc?.grants).toEqual([{ type: "user", id: "u1", level: "read_write" }]);
  });

  it("is a no-op on a second run", async () => {
    await db.collection("skills").insertOne({
      _id: "s5" as never,
      name: "x",
      isPrivate: true,
      sharedWithUsers: ["u1"],
      sharedWithOrgs: [],
    });
    const first = await backfillTypedGrants(db);
    expect(first.skillsBackfilled).toBe(1);
    const second = await backfillTypedGrants(db);
    expect(second.skillsBackfilled).toBe(0);
  });

  it("migrates skillsets the same way", async () => {
    await db.collection("skillsets").insertOne({
      _id: "ss1" as never,
      name: "set",
      isPrivate: true,
      sharedWithUsers: [],
      sharedWithOrgs: ["o9"],
    });
    const res = await backfillTypedGrants(db);
    expect(res.skillsetsBackfilled).toBe(1);
    const doc = await db.collection("skillsets").findOne({ _id: "ss1" as never });
    expect(doc?.grants).toEqual([{ type: "org", id: "o9", level: "read" }]);
  });
});
