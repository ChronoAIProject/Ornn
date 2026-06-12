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

import { afterEach, describe, expect, test } from "bun:test";
import { PostHog } from "posthog-node";
import { NoopTracker, PosthogTracker, createTracker } from "./posthog";
import type { Logger } from "../../shared/logger";

const FAKE_KEY = "phc_fake_key_for_test";
const FAKE_HOST = "https://eu.i.posthog.com";

// ---- Open-handle hygiene ---------------------------------------------
//
// Every `new PosthogTracker(...)` (directly or via `createTracker`) runs
// the constructor's `new PostHog(...)`, which spins up a live posthog-node
// v5 client. v5 arms its background flush timer lazily (first `capture`),
// so in this suite — where we swap `.client` for a stub before any capture
// reaches the real client — the timer is usually NOT armed and the process
// exits clean. But that is an implementation detail of the SDK, not a
// guarantee we want to depend on. So we register every REAL client the
// moment it is created and `await client.shutdown()` each in afterEach,
// making the no-open-handles property explicit rather than incidental.
const leakedClients: PostHog[] = [];

/** Register a real posthog-node client for deterministic draining. */
function registerForDrain(client: PostHog): void {
  leakedClients.push(client);
}

afterEach(async () => {
  // Drain every real client created during the test, swallowing failures
  // (these clients never connect to a live backend). Clear after so each
  // test only drains its own.
  await Promise.all(
    leakedClients.map((c) => c.shutdown().catch(() => undefined)),
  );
  leakedClients.length = 0;
});

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
  // The constructor already built a live `PostHog` client. Capture it for
  // draining BEFORE we overwrite the field with the stub, otherwise the
  // real client (and any timer it may have armed) is orphaned.
  const fieldSeam = tracker as unknown as { client: object };
  registerForDrain(fieldSeam.client as PostHog);
  fieldSeam.client = stub;
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

    // Redaction oracle — exact-object assertion, not a substring scan. The
    // info line MUST be EXACTLY the redacted shape: event name + redacted
    // distinctId + property KEY list, and NOTHING else (no values, no
    // stray properties body). `toEqual` fails on any extra key, so a future
    // change that leaks `properties` (or any value-bearing field) onto the
    // info line is caught structurally rather than by a fragile `:1` scan.
    expect(logger.infoCalls).toHaveLength(1);
    expect(logger.infoCalls[0]!.obj).toEqual({
      event: "skill.executed",
      distinctId: "user-id",
      propKeys: ["a", "b"],
    });

    // No error line on the happy path.
    expect(logger.errorCalls).toHaveLength(0);

    // The debug body line is the ONLY place values are allowed; it carries
    // the full properties object verbatim. Asserting its exact shape pins
    // the value/key boundary: values live here and only here.
    expect(logger.debugCalls).toHaveLength(1);
    expect(logger.debugCalls[0]!.obj).toEqual({
      event: "skill.executed",
      distinctId: "user-id",
      properties: { a: 1, b: 2 },
    });
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
    const { distinctId: loggedId, ...rest } = logger.infoCalls[0]!.obj;
    expect(loggedId).toMatch(/^anon:.*…$/);
    // The full anonymous id is never logged at info level verbatim.
    expect(loggedId).not.toBe(captured.distinctId);

    // Exact-object oracle on the rest of the info line: the volatile
    // distinctId is stripped above; everything else MUST match the redacted
    // shape with no extra value-bearing fields.
    expect(rest).toEqual({ event: "skill.viewed", propKeys: [] });
  });

  test("redactDistinctId truncates ids longer than 8 chars", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("0123456789abcdef", "evt");

    expect(logger.infoCalls[0]!.obj).toEqual({
      event: "evt",
      distinctId: "01234567…",
      propKeys: [],
    });
  });

  test("redactDistinctId leaves ids of 8 chars or fewer verbatim", () => {
    const logger = new FakeLogger();
    const client = new FakeClient();
    const tracker = trackerWith(client, logger);

    tracker.track("short", "evt");

    expect(logger.infoCalls[0]!.obj).toEqual({
      event: "evt",
      distinctId: "short",
      propKeys: [],
    });
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
    expect(logger.infoCalls[0]!.obj).toEqual({
      event: "evt",
      distinctId: "user-id",
      propKeys: [],
    });
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
    expect(logger.errorCalls[0]!.msg).toBe("PostHog capture failed");

    // Redaction oracle on the ERROR line: the property value (`1`) MUST NOT
    // leak even on the failure path. Strip the volatile `err` (an Error
    // instance) and assert the rest is EXACTLY the event name — no
    // distinctId, no propKeys, no properties body. `err` is asserted
    // separately so a future change carrying `properties` here fails.
    const { err, ...rest } = logger.errorCalls[0]!.obj;
    expect(err).toBeInstanceOf(Error);
    expect(rest).toEqual({ event: "evt" });
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
