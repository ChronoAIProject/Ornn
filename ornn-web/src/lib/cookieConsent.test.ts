import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasConsent,
  isUndecided,
  setConsent,
  onConsentChange,
  __resetConsentForTests,
} from "./cookieConsent";

afterEach(() => {
  __resetConsentForTests();
});

describe("cookieConsent", () => {
  it("starts undecided and not consenting", () => {
    expect(isUndecided()).toBe(true);
    expect(hasConsent()).toBe(false);
  });

  it("flips to granted after Accept", () => {
    setConsent("granted");
    expect(isUndecided()).toBe(false);
    expect(hasConsent()).toBe(true);
  });

  it("flips to denied after Decline", () => {
    setConsent("denied");
    expect(isUndecided()).toBe(false);
    expect(hasConsent()).toBe(false);
  });

  it("notifies subscribers of every change with the granted boolean", () => {
    const listener = vi.fn();
    const unsub = onConsentChange(listener);

    setConsent("granted");
    setConsent("denied");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, true);
    expect(listener).toHaveBeenNthCalledWith(2, false);

    unsub();
    setConsent("granted");
    expect(listener).toHaveBeenCalledTimes(2); // no further calls after unsub
  });

  it("isolates listener errors so one bad subscriber doesn't break the chain", () => {
    const good = vi.fn();
    onConsentChange(() => {
      throw new Error("boom");
    });
    onConsentChange(good);

    setConsent("granted");
    expect(good).toHaveBeenCalledWith(true);
  });
});
