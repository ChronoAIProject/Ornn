import { describe, expect, test } from "bun:test";
import {
  sourceSyncSchema,
  sourceSyncDefaults,
  sourceSyncSection,
} from "./sourceSync";

describe("sourceSync section", () => {
  test("defaults parse and ship inert (disabled, no token, no auto-publish)", () => {
    const parsed = sourceSyncSchema.parse(sourceSyncDefaults);
    expect(parsed.enabled).toBe(false);
    expect(parsed.githubToken).toBe("");
    expect(parsed.autoPublish).toBe(false);
    expect(parsed.minCheckIntervalMinutes).toBe(60);
  });

  test("githubToken is a secret field (encrypted at rest + masked on GET)", () => {
    expect(sourceSyncSection.secretFields).toContain("githubToken");
  });

  test("empty pollSchedule (disabled) is accepted", () => {
    const parsed = sourceSyncSchema.parse({ ...sourceSyncDefaults, pollSchedule: "" });
    expect(parsed.pollSchedule).toBe("");
  });

  test("a valid cron is accepted", () => {
    const parsed = sourceSyncSchema.parse({
      ...sourceSyncDefaults,
      pollSchedule: "0 * * * *",
    });
    expect(parsed.pollSchedule).toBe("0 * * * *");
  });

  test("an invalid cron is rejected", () => {
    expect(() =>
      sourceSyncSchema.parse({ ...sourceSyncDefaults, pollSchedule: "not a cron" }),
    ).toThrow();
  });

  test("minCheckIntervalMinutes must be a positive integer", () => {
    expect(() =>
      sourceSyncSchema.parse({ ...sourceSyncDefaults, minCheckIntervalMinutes: 0 }),
    ).toThrow();
    expect(() =>
      sourceSyncSchema.parse({ ...sourceSyncDefaults, minCheckIntervalMinutes: 1.5 }),
    ).toThrow();
  });

  test("section id + publicPath are stable", () => {
    expect(sourceSyncSection.id).toBe("sourceSync");
    expect(sourceSyncSection.publicPath).toBe("sourceSync");
  });
});
