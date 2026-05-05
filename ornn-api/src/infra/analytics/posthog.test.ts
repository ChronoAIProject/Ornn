/**
 * Tests for the PostHog tracker construction logic. We don't exercise the
 * real `posthog-node` client here — that's an external dependency. We
 * verify the factory picks Noop vs Posthog correctly and the
 * Noop implementation is a true no-op.
 */

import { describe, expect, test } from "bun:test";
import { NoopTracker, PosthogTracker, createTracker } from "./posthog";

describe("NoopTracker", () => {
  test("track is a no-op (no throw, no return value)", () => {
    const tracker = new NoopTracker();
    expect(() => tracker.track("u-1", "x", { y: 1 })).not.toThrow();
    expect(() => tracker.track(null, "x")).not.toThrow();
  });

  test("shutdown resolves without error", async () => {
    const tracker = new NoopTracker();
    await expect(tracker.shutdown()).resolves.toBeUndefined();
  });
});

describe("createTracker", () => {
  test("returns NoopTracker when posthogApiKey is null", () => {
    const tracker = createTracker({
      posthogApiKey: null,
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: null,
    });
    expect(tracker).toBeInstanceOf(NoopTracker);
  });

  test("returns NoopTracker when posthogApiKey is empty string", () => {
    const tracker = createTracker({
      posthogApiKey: "",
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: null,
    });
    expect(tracker).toBeInstanceOf(NoopTracker);
  });

  test("returns PosthogTracker when posthogApiKey is set", async () => {
    const tracker = createTracker({
      posthogApiKey: "phc_fake_key_for_test",
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: "fake-project",
    });
    expect(tracker).toBeInstanceOf(PosthogTracker);
    // Drain so the test process exits cleanly. Failures from the
    // network shutdown are swallowed by the impl.
    await tracker.shutdown();
  });
});
