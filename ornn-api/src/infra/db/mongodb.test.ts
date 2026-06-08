/**
 * Tests for `connectMongo` (#883 coverage).
 *
 * Happy path runs against a real `mongodb-memory-server` instance so the
 * `client.connect()` → admin `ping` → `client.db(name)` sequence and the
 * returned `close()` are exercised end-to-end with no network egress.
 *
 * The retry-exhaustion branch is driven by a deliberately unroutable URI
 * with a sub-second `serverSelectionTimeoutMS` / `connectTimeoutMS` in
 * the query string so each of the 5 attempts fails fast. We do NOT
 * `mock.module("mongodb")`: that mock is process-global and would poison
 * the memory-server happy path sharing this file.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectMongo } from "./mongodb";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
});

afterAll(async () => {
  await mongo.stop();
});

describe("connectMongo", () => {
  it("connects, pings, exposes the named db, and closes cleanly", async () => {
    const conn = await connectMongo(mongo.getUri(), "mongodb_connect_test");
    expect(conn.client).toBeDefined();
    expect(conn.db.databaseName).toBe("mongodb_connect_test");

    // The connection is live: a trivial command round-trips.
    const pong = await conn.db.admin().ping();
    expect(pong.ok).toBe(1);

    await expect(conn.close()).resolves.toBeUndefined();
  });

  it("throws after exhausting retries when the server is unreachable", async () => {
    // Reserved-for-documentation TEST-NET-1 address (RFC 5737) that never
    // accepts connections; fast per-attempt timeouts keep total wall-clock
    // bounded (5 attempts + exponential backoff ~15s).
    const badUri =
      "mongodb://192.0.2.1:27017/?serverSelectionTimeoutMS=50&connectTimeoutMS=50&socketTimeoutMS=50";
    await expect(connectMongo(badUri, "unreachable_db")).rejects.toThrow(
      /MongoDB connection failed after 5 attempts/,
    );
  }, 30_000);
});
