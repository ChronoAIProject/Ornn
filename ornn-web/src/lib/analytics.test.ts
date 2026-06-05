import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the underlying SDK — analytics.ts is the surface we test, not the
// SDK itself. Mock targets must be hoisted, so define them inside the
// factory and surface them via getters.
const captureMock = vi.fn();
const identifyMock = vi.fn();
const resetMock = vi.fn();
const initMock = vi.fn();
const optInMock = vi.fn();
const optOutMock = vi.fn();
const startReplayMock = vi.fn();
const stopReplayMock = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => {
      initMock(...args);
      const opts = args[1] as { loaded?: () => void };
      // Mirror the real lifecycle: invoke `loaded` synchronously so the
      // wrapper's flushBuffer fires inside the test's `act`.
      opts?.loaded?.();
    },
    capture: captureMock,
    identify: identifyMock,
    reset: resetMock,
    opt_in_capturing: optInMock,
    opt_out_capturing: optOutMock,
    startSessionRecording: startReplayMock,
    stopSessionRecording: stopReplayMock,
  },
}));

// Default `@/config` mock — overridden per test via vi.doMock + resetModules.
vi.mock("@/config", () => ({
  config: {
    apiBaseUrl: "",
    nyxidApiBaseUrl: "",
    nyxidWebBaseUrl: "",
    nyxidOauthAuthorizeUrl: "",
    nyxidOauthTokenUrl: "",
    nyxidOauthClientId: "",
    nyxidOauthRedirectUri: "",
    nyxidLogoutUrl: "",
    nyxidSettingsUrl: "",
    posthogApiKey: "phc_test_key",
    posthogProjectId: "test-project",
    posthogHost: "https://eu.i.posthog.com",
  },
}));

/**
 * Re-import analytics + cookieConsent together. They share module state
 * (analytics keeps an `initStarted` flag; cookieConsent keeps a listener
 * Set). Tests need both reset together to avoid stale wiring.
 */
async function freshModules() {
  vi.resetModules();
  const consent = await import("./cookieConsent");
  const analytics = await import("./analytics");
  consent.__resetConsentForTests();
  return { consent, analytics };
}

// The frontend logger forwards `error` to `console.error` in the dev/test
// branch (MODE !== "production"). Spy on it so swallow tests can assert the
// failure was *logged with context*, not just silently absorbed.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureMock.mockClear();
  identifyMock.mockClear();
  resetMock.mockClear();
  initMock.mockClear();
  optInMock.mockClear();
  optOutMock.mockClear();
  startReplayMock.mockClear();
  stopReplayMock.mockClear();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  // A test may have swapped the `@/config` mock via `vi.doMock` + a paired
  // `vi.doUnmock`; the unmock only takes effect on the next module-registry
  // reset, so flush it here to keep config state from leaking forward.
  vi.resetModules();
  // Don't leak consent state into the next test file's localStorage.
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  }
});

describe("analytics wrapper", () => {
  it("buffers track calls until consent is granted, then flushes", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();

    // Pre-consent: nothing should reach posthog.capture.
    analytics.track("login.completed", { provider: "nyxid" });
    expect(captureMock).not.toHaveBeenCalled();

    // Granting consent triggers the wrapper's onConsentChange listener,
    // which opts back in + flushes the buffer.
    consent.setConsent("granted");
    expect(optInMock).toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledWith("login.completed", { provider: "nyxid" });
  });

  it("opts out and resets the distinct id when consent is revoked", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");

    consent.setConsent("denied");
    expect(stopReplayMock).toHaveBeenCalled();
    expect(optOutMock).toHaveBeenCalled();
    expect(resetMock).toHaveBeenCalled();
  });

  it("forwards identify with mapped traits", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");

    analytics.identify("user-42", {
      email: "ada@example.com",
      displayName: "Ada",
      isAdmin: true,
      signupAt: "2026-01-01T00:00:00.000Z",
    });

    expect(identifyMock).toHaveBeenCalledWith("user-42", {
      email: "ada@example.com",
      name: "Ada",
      is_admin: true,
      signup_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("no-ops when posthog is not configured", async () => {
    // Override the config mock for this test only.
    vi.doMock("@/config", () => ({
      config: {
        apiBaseUrl: "",
        nyxidApiBaseUrl: "",
        nyxidWebBaseUrl: "",
        nyxidOauthAuthorizeUrl: "",
        nyxidOauthTokenUrl: "",
        nyxidOauthClientId: "",
        nyxidOauthRedirectUri: "",
        nyxidLogoutUrl: "",
        nyxidSettingsUrl: "",
        posthogApiKey: "",
        posthogProjectId: "",
        posthogHost: "",
      },
    }));
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    analytics.track("login.completed");
    consent.setConsent("granted");
    analytics.track("login.completed");
    expect(initMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();

    // Restore the populated config mock. `vi.doUnmock` would unmask the real
    // `@/config`, which reads empty runtime values under jsdom and leaks an
    // unconfigured PostHog into later tests; re-`doMock` the configured one
    // instead so ordering stays hermetic.
    vi.doMock("@/config", () => ({
      config: {
        apiBaseUrl: "",
        nyxidApiBaseUrl: "",
        nyxidWebBaseUrl: "",
        nyxidOauthAuthorizeUrl: "",
        nyxidOauthTokenUrl: "",
        nyxidOauthClientId: "",
        nyxidOauthRedirectUri: "",
        nyxidLogoutUrl: "",
        nyxidSettingsUrl: "",
        posthogApiKey: "phc_test_key",
        posthogProjectId: "test-project",
        posthogHost: "https://eu.i.posthog.com",
      },
    }));
  });

  it("swallows a throwing posthog.init without escaping", async () => {
    initMock.mockImplementationOnce(() => {
      throw new Error("init boom");
    });
    const { analytics } = await freshModules();
    // The wrapper catches the init failure; nothing should propagate.
    expect(() => analytics.initAnalytics()).not.toThrow();
    expect(initMock).toHaveBeenCalledTimes(1);
    // ...and the failure is logged with context (logger.error → console.error).
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls.some((c) => String(c[0]).includes("init failed"))).toBe(true);
  });

  it("is a no-op on a second initAnalytics() call (initStarted guard)", async () => {
    const { analytics } = await freshModules();
    analytics.initAnalytics();
    analytics.initAnalytics();
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it("swallows capture / identify / reset failures", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");

    captureMock.mockImplementationOnce(() => {
      throw new Error("capture boom");
    });
    identifyMock.mockImplementationOnce(() => {
      throw new Error("identify boom");
    });
    resetMock.mockImplementationOnce(() => {
      throw new Error("reset boom");
    });

    expect(() => analytics.track("login.completed")).not.toThrow();
    expect(() => analytics.identify("user-7")).not.toThrow();
    expect(() => analytics.reset()).not.toThrow();

    // Each swallow path logs its own contextual error message.
    const messages = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("capture failed"))).toBe(true);
    expect(messages.some((m) => m.includes("identify failed"))).toBe(true);
    expect(messages.some((m) => m.includes("reset failed"))).toBe(true);
  });

  it("emits reset directly once consent is granted", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");
    resetMock.mockClear();

    analytics.reset();
    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it("buffers reset before consent, then flushes it on grant", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();

    // Pre-consent reset is buffered, not emitted.
    analytics.reset();
    expect(resetMock).not.toHaveBeenCalled();

    consent.setConsent("granted");
    // flushBuffer replays the buffered reset.
    expect(resetMock).toHaveBeenCalled();
  });

  it("survives a replay failure while flushing the buffer", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();

    // Buffer a track call before consent.
    analytics.track("login.completed", { provider: "nyxid" });
    captureMock.mockImplementationOnce(() => {
      throw new Error("replay boom");
    });

    // Granting consent flushes the buffer; the throwing replay is caught.
    expect(() => consent.setConsent("granted")).not.toThrow();
    // ...and the caught replay failure is logged with context.
    expect(
      consoleErrorSpy.mock.calls.some((c) =>
        String(c[0]).includes("Buffered call replay failed"),
      ),
    ).toBe(true);
  });

  it("early-returns identify when userId is empty", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");
    identifyMock.mockClear();

    analytics.identify("");
    expect(identifyMock).not.toHaveBeenCalled();
  });

  it("stops recording, opts out, and resets on consent revoke", async () => {
    const { analytics, consent } = await freshModules();
    analytics.initAnalytics();
    consent.setConsent("granted");

    stopReplayMock.mockClear();
    optOutMock.mockClear();
    resetMock.mockClear();

    consent.setConsent("denied");
    expect(stopReplayMock).toHaveBeenCalledTimes(1);
    expect(optOutMock).toHaveBeenCalledTimes(1);
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
