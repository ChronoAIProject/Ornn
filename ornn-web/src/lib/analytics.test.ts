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

beforeEach(() => {
  captureMock.mockClear();
  identifyMock.mockClear();
  resetMock.mockClear();
  initMock.mockClear();
  optInMock.mockClear();
  optOutMock.mockClear();
  startReplayMock.mockClear();
  stopReplayMock.mockClear();
});

afterEach(() => {
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

    vi.doUnmock("@/config");
  });
});
