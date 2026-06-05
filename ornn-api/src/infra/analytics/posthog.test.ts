/**
 * Tests for the PostHog tracker construction logic. We don't exercise the
 * real `posthog-node` client here — that's an external dependency. We
 * verify the factory picks Noop vs Posthog correctly and the
 * Noop implementation is a true no-op.
 *
 * The `PosthogTracker.track / shutdown` block (#880) exercises the
 * fire-and-forget emission path, the distinctId redaction contract, and
 * the fail-open error handling WITHOUT touching the network. We construct
 * a real `PosthogTracker` (so the constructor's `new PostHog(...)` runs)
 * and then overwrite its private `client` field with a hand-rolled stub
 * via the established `as unknown as` field-cast seam — no `mock.module`,
 * which is process-global and unsafe across the suite (see
 * safeFetch.test.ts:26-28). A hand-rolled logger captures every arg so we
 * can assert the redaction contract: property KEYS are logged, property
 * VALUES never are.
 */

import { describe, expect, test } from "bun:test";
import { PostHog } from "posthog-node";
import { NoopTracker, PosthogTracker, createTracker } from "./posthog";
import type { Logger } from "../../shared/logger";

const FAKE_KEY = "phc_fake_key_for_test";
const FAKE_HOST = "https://eu.i.posthog.com";

// ---- Test doubles ----------------------------------------------------

interface LogCall {
  readonly obj: Record<string, unknown>;
  readonly msg: string;
}

/** Hand-rolled pino-shaped logger that records every call's args. */
class FakeLogger {
  readonly infoCalls: LogCall[] = [];
  readonly debugCalls: LogCall[] = [];
  readonly errorCalls: LogCall[] = [];

  info(obj: Record<string, unknown>, msg: string): void {
    this.infoCalls.push({ obj, msg });
  }
  debug(obj: Record<string, unknown>, msg: string): void {
    this.debugCalls.push({ obj, msg });
  }
  error(obj: Record<string, unknown>, msg: string): void {
    this.errorCalls.push({ obj, msg });
  }
  // The tracker calls `logger.child(...)` once in the constructor; return
  // self so the child shares the same capture arrays.
  child(): FakeLogger {
    return this;
  }

  asLogger(): Logger {
    return this as unknown as Logger;
  }

  /** Every object arg passed to any level, flattened for value scans. */
  allLoggedObjects(): Record<string, unknown>[] {
    return [...this.infoCalls, ...this.debugCalls, ...this.errorCalls].map((c) => c.obj);
  }
}

/** Minimal `posthog-node` client surface the tracker drives. */
interface CaptureArg {
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown>;
}

class FakeClient {
  readonly captureCalls: CaptureArg[] = [];

  capture(arg: CaptureArg): void {
    this.captureCalls.push(arg);
  }
  async shutdown(): Promise<void> {
    /* resolves */
  }
}

/**
 * Construct a real tracker, then swap its private `client` for `stub`.
 * The constructor still ran `new PostHog(...)`; we replace the field so
 * `track`/`shutdown` drive the stub instead of the live client. This is
 * the constructor/field-cast seam — no `mock.module`.
 */
function trackerWith(stub: object, logger: FakeLogger, projectId?: string | null): PosthogTracker {
  const tracker = new PosthogTracker(
    {
      apiKey: FAKE_KEY,
      host: FAKE_HOST,
      ...(projectId !== undefined ? { projectId } : {}),
    },
    logger.asLogger(),
  );
  (tracker as unknown as { client: object }).client = stub;
  return tracker;
}

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
  test("returns NoopTracker when posthogEnabled is false", () => {
    const tracker = createTracker({
      posthogEnabled: false,
      posthogApiKey: "phc_fake_key_for_test",
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: null,
    });
    expect(tracker).toBeInstanceOf(NoopTracker);
  });

  test("returns NoopTracker when posthogApiKey is null", () => {
    const tracker = createTracker({
      posthogEnabled: true,
      posthogApiKey: null,
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: null,
    });
    expect(tracker).toBeInstanceOf(NoopTracker);
  });

  test("returns NoopTracker when posthogApiKey is empty string", () => {
    const tracker = createTracker({
      posthogEnabled: true,
      posthogApiKey: "",
      posthogHost: "https://eu.i.posthog.com",
      posthogProjectId: null,
    });
    expect(tracker).toBeInstanceOf(NoopTracker);
  });

  test("returns PosthogTracker when enabled with a key", async () => {
    const tracker = createTracker({
      posthogEnabled: true,
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

describe("PosthogTracker.track / shutdown", () => {
  test("happy path: captures the event and logs key list without values", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("user-id", "skill.executed", { a: 1, b: 2 });

    // The SDK was driven exactly once with the caller's distinctId + props.
    expect(client.captureCalls).toHaveLength(1);
    const captured = client.captureCalls[0]!;
    expect(captured.distinctId).toBe("user-id");
    expect(captured.event).toBe("skill.executed");
    expect(captured.properties).toEqual({ a: 1, b: 2 });

    // info logged once with the property KEY list.
    expect(logger.infoCalls).toHaveLength(1);
    expect(logger.infoCalls[0]!.obj.propKeys).toEqual(["a", "b"]);

    // Redaction contract: no property VALUE (1 or 2) appears in ANY log
    // object arg. JSON-serialize each and scan for the values.
    for (const obj of logger.allLoggedObjects()) {
      // `properties` is intentionally only present on the debug body line;
      // strip it before scanning so we test the info/error redaction, not
      // the deliberate debug-level body.
      const { properties: _props, ...rest } = obj;
      const serialized = JSON.stringify(rest);
      expect(serialized).not.toContain(":1");
      expect(serialized).not.toContain(":2");
    }
  });

  test("anonymous caller gets an anon: distinctId and it stays redacted", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track(null, "skill.viewed");

    expect(client.captureCalls).toHaveLength(1);
    const captured = client.captureCalls[0]!;
    expect(captured.distinctId).toMatch(/^anon:/);

    // The logged distinctId is the redacted form (anon: + 8 chars head is
    // longer than 8 so it gets truncated with the ellipsis).
    const loggedId = logger.infoCalls[0]!.obj.distinctId as string;
    expect(loggedId).toMatch(/^anon:.*…$/);
    // The full anonymous id is never logged at info level verbatim.
    expect(loggedId).not.toBe(captured.distinctId);
  });

  test("redactDistinctId truncates ids longer than 8 chars", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("0123456789abcdef", "evt");

    expect(logger.infoCalls[0]!.obj.distinctId).toBe("01234567…");
  });

  test("redactDistinctId leaves ids of 8 chars or fewer verbatim", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("short", "evt");

    expect(logger.infoCalls[0]!.obj.distinctId).toBe("short");
  });

  test("omits the properties key on capture when no properties are passed", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("user-id", "evt");

    const captured = client.captureCalls[0]!;
    // exactOptionalPropertyTypes (#657): the spread omits `properties`
    // entirely rather than passing `undefined`.
    expect("properties" in captured).toBe(false);
    expect(logger.infoCalls[0]!.obj.propKeys).toEqual([]);
  });

  test("fail-open: a throwing capture is caught and logged, never rethrown", () => {
    const logger = new FakeLogger();
    const throwing = {
      capture(): void {
        throw new Error("transport down");
      },
      async shutdown(): Promise<void> {
        /* resolves */
      },
    };
    const tracker = trackerWith(throwing, logger);

    expect(() => tracker.track("user-id", "evt", { a: 1 })).not.toThrow();
    expect(logger.errorCalls).toHaveLength(1);
    expect(logger.errorCalls[0]!.obj.event).toBe("evt");
    expect(logger.errorCalls[0]!.msg).toBe("PostHog capture failed");
  });

  test("shutdown success logs an info line", async () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger, "proj-1");

    await expect(tracker.shutdown()).resolves.toBeUndefined();
    const infoMsgs = logger.infoCalls.map((c) => c.msg);
    expect(infoMsgs).toContain("PostHog client shut down");
  });

  test("shutdown swallows a rejecting client.shutdown() and logs the error", async () => {
    const logger = new FakeLogger();
    const rejecting = {
      capture(): void {
        /* unused */
      },
      async shutdown(): Promise<void> {
        throw new Error("drain failed");
      },
    };
    const tracker = trackerWith(rejecting, logger);

    // Fail-open: never rejects, even though the underlying drain threw.
    await expect(tracker.shutdown()).resolves.toBeUndefined();
    expect(logger.errorCalls).toHaveLength(1);
    expect(logger.errorCalls[0]!.msg).toBe("PostHog shutdown failed");
  });

  test("constructor registers an on('error') handler that logs transport errors", async () => {
    const logger = new FakeLogger();

    // Capture the handler the *constructor* installs on its live client by
    // intercepting `PostHog.prototype.on` for the duration of construction.
    // This is a prototype patch on the already-imported class (restored in
    // `finally`) — NOT `mock.module`, so it is process-local and torn down
    // deterministically. It lets us invoke the real source closure (which
    // closes over `this.logger`) rather than a re-implementation.
    let registered: ((err: unknown) => void) | undefined;
    const proto = PostHog.prototype as unknown as {
      on?: (event: string, fn: (err: unknown) => void) => void;
    };
    const original = proto.on;
    proto.on = function patchedOn(event: string, fn: (err: unknown) => void): void {
      if (event === "error") registered = fn;
    };

    let tracker: PosthogTracker;
    try {
      tracker = new PosthogTracker({ apiKey: FAKE_KEY, host: FAKE_HOST }, logger.asLogger());
    } finally {
      if (original) proto.on = original;
      else delete proto.on;
    }

    expect(registered).toBeDefined();
    registered!(new Error("buffered flush failed"));

    const errMsgs = logger.errorCalls.map((c) => c.msg);
    expect(errMsgs).toContain("PostHog transport error");

    // Drain the live client so the test process exits cleanly.
    await tracker.shutdown();
  });
});
