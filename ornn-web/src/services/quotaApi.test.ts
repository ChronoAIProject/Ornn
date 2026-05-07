/**
 * UT-WEB-MEQUOTA-SHAPE-001 — RT-ME-QUOTA-SHAPE.
 *
 * The Zod parser for `/me/quota` must reject any payload still carrying
 * the legacy `daily.*` block. A backend that drifts back to the old
 * shape must surface as a hard parse error on the client, not silently
 * swallowed.
 *
 * @module services/quotaApi.test
 */

import { describe, it, expect } from "vitest";
import { QuotaSnapshotSchema } from "./quotaApi.schema";

const validSurface = {
  defaultAllotment: 200,
  adminGrant: 0,
  used: 5,
  remaining: 195,
  warningThreshold: 0.8,
  warning: false,
};

const validSnapshot = {
  isAdmin: false,
  monthMarker: "2026-05",
  monthStart: "2026-05-01T00:00:00.000Z",
  monthEnd: "2026-06-01T00:00:00.000Z",
  nextMonthlyResetAt: "2026-06-01T00:00:00.000Z",
  playground: validSurface,
  skillGen: { ...validSurface, defaultAllotment: 20, remaining: 15, used: 5 },
};

describe("/me/quota schema", () => {
  it("accepts the v1 shape", () => {
    const r = QuotaSnapshotSchema.safeParse(validSnapshot);
    expect(r.success).toBe(true);
  });

  it("rejects payloads carrying the legacy daily block", () => {
    const r = QuotaSnapshotSchema.safeParse({
      ...validSnapshot,
      playground: { ...validSurface, daily: { limit: 50, used: 1, remaining: 49 } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unrecognized top-level keys", () => {
    const r = QuotaSnapshotSchema.safeParse({
      ...validSnapshot,
      monthlyResetAt: "2026-06-01T00:00:00.000Z", // legacy field
    });
    expect(r.success).toBe(false);
  });
});
