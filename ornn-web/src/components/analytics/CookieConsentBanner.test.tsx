/**
 * CookieConsentBanner tests — useSyncExternalStore wiring (#888).
 *
 * The banner replaced a mount effect (that set visibility + wired a
 * listener) with a single `useSyncExternalStore(onConsentChange,
 * isUndecided, isUndecided)`. Visibility is therefore a pure read of the
 * consent store: visible exactly while undecided. When the store flips to
 * a decided state and notifies subscribers, React re-reads the snapshot
 * and the banner hides — with NO prop change / parent rerender.
 *
 * STALE-STATE-FIRST oracle: mount while the store is undecided (banner
 * visible), then flip the controllable store to "decided" and fire the
 * captured `onConsentChange` subscriber → the banner self-hides on the
 * next snapshot read, proving the subscribe/getSnapshot wiring is live and
 * not a one-shot mount read.
 *
 * `@/lib/cookieConsent` is mocked with a controllable in-test store so we
 * can drive `isUndecided` + capture the subscriber. react-i18next (incl.
 * Trans) is stubbed globally in src/test/setup.ts.
 *
 * @module components/analytics/CookieConsentBanner.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Controllable consent store. `undecided` drives `isUndecided`; the
// subscriber fn registered by useSyncExternalStore is captured so the test
// can fire it on demand (simulating a store notification) without touching
// the real localStorage-backed module.
const store = {
  undecided: true,
  subscribers: new Set<(granted: boolean) => void>(),
};

const setConsent = vi.fn((state: "granted" | "denied") => {
  store.undecided = false;
  for (const fn of store.subscribers) fn(state === "granted");
});

vi.mock("@/lib/cookieConsent", () => ({
  isUndecided: () => store.undecided,
  setConsent: (state: "granted" | "denied") => setConsent(state),
  onConsentChange: (fn: (granted: boolean) => void) => {
    store.subscribers.add(fn);
    return () => store.subscribers.delete(fn);
  },
}));

import { CookieConsentBanner } from "./CookieConsentBanner";

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsentBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.undecided = true;
  store.subscribers.clear();
  setConsent.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("CookieConsentBanner — useSyncExternalStore visibility", () => {
  it("is visible when mounted in the undecided state", () => {
    renderBanner();
    expect(screen.getByTestId("cookie-consent-banner")).toBeInTheDocument();
    // The store registered a live subscriber via useSyncExternalStore.
    expect(store.subscribers.size).toBeGreaterThan(0);
  });

  it("hides after the store flips decided and notifies — WITHOUT a prop rerender", () => {
    renderBanner();
    expect(screen.getByTestId("cookie-consent-banner")).toBeInTheDocument();

    // Force the wrong state directly on the store, then fire the captured
    // subscriber — exactly how an external decision (e.g. another component
    // calling setConsent) would notify. No prop change, no rerender call.
    // Wrapped in act() so React flushes the useSyncExternalStore update that
    // the out-of-band notification schedules.
    act(() => {
      store.undecided = false;
      for (const fn of store.subscribers) fn(true);
    });

    // React re-reads the snapshot (now decided) and the banner unmounts.
    expect(screen.queryByTestId("cookie-consent-banner")).not.toBeInTheDocument();
  });

  it("hides when the user clicks Accept (drives setConsent → notify)", () => {
    renderBanner();
    expect(screen.getByTestId("cookie-consent-banner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    expect(setConsent).toHaveBeenCalledWith("granted");
    expect(screen.queryByTestId("cookie-consent-banner")).not.toBeInTheDocument();
  });
});
