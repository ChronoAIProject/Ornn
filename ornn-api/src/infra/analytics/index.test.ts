/**
 * Tests for the high-level AnalyticsEmitter — uses a fake tracker so we
 * can assert on the call sites without instantiating `posthog-node`.
 */

import { describe, expect, test, mock, afterEach } from "bun:test";
import { AnalyticsEmitter, type AnalyticsTracker } from "./index";

class FakeTracker implements AnalyticsTracker {
  readonly calls: Array<{
    userId: string | null;
    event: string;
    properties?: Readonly<Record<string, unknown>>;
  }> = [];
  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void {
    this.calls.push({ userId, event, properties });
  }
  async shutdown(): Promise<void> {
    /* no-op */
  }
}

describe("AnalyticsEmitter", () => {
  const originalRandom = Math.random;
  afterEach(() => {
    Math.random = originalRandom;
  });

  test("trackSkillPull emits api.skill.pull with callerType + skillId", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });

    emitter.trackSkillPull({
      userId: "u-1",
      skillId: "skill-guid-1",
      skillName: "demo",
      skillVersion: "1.0",
      callerType: "api",
    });

    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]!.userId).toBe("u-1");
    expect(tracker.calls[0]!.event).toBe("api.skill.pull");
    // `source: "api"` is auto-merged by the emitter so dashboards can
    // split server- vs client-originated events of the same name.
    expect(tracker.calls[0]!.properties).toEqual({
      source: "api",
      callerType: "api",
      skillId: "skill-guid-1",
      skillName: "demo",
      skillVersion: "1.0",
    });
  });

  test("trackSkillPublished emits api.skill.published with isNewSkill flag", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });

    emitter.trackSkillPublished({
      userId: "u-2",
      skillId: "guid-2",
      skillName: "calc",
      skillVersion: "2.1",
      isNewSkill: true,
    });

    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]!.event).toBe("api.skill.published");
    expect(tracker.calls[0]!.properties).toMatchObject({
      skillId: "guid-2",
      skillVersion: "2.1",
      isNewSkill: true,
    });
  });

  test("trackApiError forwards the event when sample roll wins", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });
    Math.random = mock(() => 0.0); // always pass — < 1.0

    emitter.trackApiError({
      userId: "u-3",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      method: "POST",
      path: "/api/v1/skills",
      requestId: "rid-1",
    });

    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]!.event).toBe("api.error");
    expect(tracker.calls[0]!.properties).toMatchObject({
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      method: "POST",
      path: "/api/v1/skills",
      requestId: "rid-1",
    });
  });

  test("trackApiError drops the event when sample roll loses", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 0.1 });
    Math.random = mock(() => 0.5); // > 0.1 — drop

    emitter.trackApiError({
      userId: "u-3",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      method: "POST",
      path: "/api/v1/skills",
    });

    expect(tracker.calls).toHaveLength(0);
  });

  test("trackApiError always drops when sampleRate=0", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 0 });
    Math.random = mock(() => 0); // even 0 fails: !(0 < 0)

    emitter.trackApiError({
      userId: "u-3",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      method: "POST",
      path: "/api/v1/skills",
    });

    expect(tracker.calls).toHaveLength(0);
  });

  test("clamp: errorSampleRate is clamped to [0, 1]", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 5 });
    Math.random = mock(() => 0.99); // anything < 1 must pass

    emitter.trackApiError({
      userId: null,
      statusCode: 503,
      errorCode: "UPSTREAM_DOWN",
      method: "GET",
      path: "/livez",
    });

    expect(tracker.calls).toHaveLength(1);
  });

  test("track passes through arbitrary events and properties", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });

    emitter.track("u-7", "custom.event", { foo: "bar", count: 1 });
    expect(tracker.calls[0]).toEqual({
      userId: "u-7",
      event: "custom.event",
      // `source: "api"` is auto-merged by every track* call.
      properties: { source: "api", foo: "bar", count: 1 },
    });
  });

  test("trackPlatformActivity emits the action as event name with source", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });

    emitter.trackPlatformActivity({
      userId: "u-9",
      userEmail: "u-9@x.test",
      userDisplayName: "Niner",
      action: "skill.deleted",
      properties: { skillId: "g-1", adminAction: true },
    });

    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]!.event).toBe("skill.deleted");
    expect(tracker.calls[0]!.userId).toBe("u-9");
    expect(tracker.calls[0]!.properties).toEqual({
      source: "api",
      actorEmail: "u-9@x.test",
      actorDisplayName: "Niner",
      skillId: "g-1",
      adminAction: true,
    });
  });

  test("trackApiRequest emits api.request with metadata only (no body)", () => {
    const tracker = new FakeTracker();
    const emitter = new AnalyticsEmitter({ tracker, errorSampleRate: 1 });

    emitter.trackApiRequest({
      userId: "u-1",
      callerType: "web",
      method: "POST",
      path: "/api/v1/skills/g-1",
      routePattern: "/skills/:id",
      status: 200,
      durationMs: 42,
      sourceIp: "1.2.3.0",
      requestId: "req-1",
    });

    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]!.event).toBe("api.request");
    expect(tracker.calls[0]!.properties).toEqual({
      source: "api",
      callerType: "web",
      method: "POST",
      path: "/api/v1/skills/g-1",
      routePattern: "/skills/:id",
      status: 200,
      durationMs: 42,
      sourceIp: "1.2.3.0",
      requestId: "req-1",
    });
  });
});
