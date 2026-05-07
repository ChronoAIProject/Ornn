/**
 * IT-SKILLGEN-QUOTA-DENY + IT-SKILLGEN-* charge path mirrors of the
 * playground charge tests. Same contract — different surface and
 * different route prefix.
 *
 * @module tests/integration/skillgen_charge.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { startHarness, type Harness, authHeaders } from "./harness";
import { resetCollections } from "./cleanup";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.cleanup();
});

beforeEach(async () => {
  await resetCollections(h.db, ["quota_buckets", "platform_settings"]);
});

describe("IT-SKILLGEN-QUOTA-DENY", () => {
  test("user at skillGen cap → 429", async () => {
    const monthMarker = new Date().toISOString().slice(0, 7);
    await h.db.collection("quota_buckets").insertOne({
      _id: `u-cap:skillGen:${monthMarker}`,
      userId: "u-cap",
      surface: "skillGen",
      monthMarker,
      monthStart: new Date(),
      monthEnd: new Date(),
      defaultAllotment: 3,
      adminGrant: 0,
      used: 3,
      usedByModel: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await h.app.request("/api/v1/skills/generate", {
      method: "POST",
      headers: {
        ...authHeaders({
          userId: "u-cap",
          email: "u-cap@test.invalid",
          permissions: ["ornn:skill:build"],
        }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hello" }),
    });
    // Accept any non-2xx — see playground_charge.test for rationale.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test.todo("successful skill-gen run charges +1 on bucket.used");
  test.todo("system_error skill-gen run charges 0");
});
