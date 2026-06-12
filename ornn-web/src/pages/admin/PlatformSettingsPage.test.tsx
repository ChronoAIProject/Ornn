/**
 * PlatformSettingsPage tests — re-seed-on-refetch guard (#888).
 *
 * The threshold input is seeded from the loaded settings using the "adjust
 * state during render" guard keyed on the server object IDENTITY (not its
 * value): a refetch that produces a NEW settings object re-seeds the
 * input, but a same-reference rerender preserves the admin's in-flight
 * local edit.
 *
 * STALE-STATE-FIRST oracle: seed from v1, DIRTY the input (force a value
 * that diverges from the server), then (a) rerender with the SAME settings
 * ref → the dirty edit survives; (b) rerender with a NEW settings ref
 * (refetch) → the input re-seeds to the server value, discarding the edit.
 *
 * Hooks + toast store are mocked so the page renders without the apiClient
 * chain. PageTransition's framer-motion is stubbed pass-through.
 * react-i18next is stubbed globally in src/test/setup.ts.
 *
 * @module pages/admin/PlatformSettingsPage.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlatformSettings } from "@/services/platformSettingsApi";

const usePlatformSettings = vi.fn();
const useUpdatePlatformSettings = vi.fn();
const addToast = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          variants: _v,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          void _v;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

vi.mock("@/hooks/usePlatformSettings", () => ({
  usePlatformSettings: () => usePlatformSettings(),
  useUpdatePlatformSettings: () => useUpdatePlatformSettings(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { PlatformSettingsPage } from "./PlatformSettingsPage";

function settings(threshold: number): PlatformSettings {
  return { auditWaiverThreshold: threshold };
}

function thresholdInput(): HTMLInputElement {
  return screen.getByLabelText(/audit waiver threshold/i) as HTMLInputElement;
}

/** Loading-state query return (data not yet arrived). */
function loading() {
  return { data: undefined, isLoading: true, isError: false } as const;
}

function loaded(data: PlatformSettings) {
  return { data, isLoading: false, isError: false } as const;
}

beforeEach(() => {
  usePlatformSettings.mockReset();
  useUpdatePlatformSettings.mockReset();
  addToast.mockReset();
  useUpdatePlatformSettings.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("PlatformSettingsPage — re-seed on refetch", () => {
  it("seeds the input once the settings arrive", () => {
    // The guard initialises prevSettings to whatever `data` is on the FIRST
    // render, so the seed only fires when data transitions undefined → v1
    // (the real query lifecycle). Render loading first, then loaded.
    usePlatformSettings.mockReturnValue(loading());
    const { rerender } = render(<PlatformSettingsPage />);

    usePlatformSettings.mockReturnValue(loaded(settings(6)));
    rerender(<PlatformSettingsPage />);
    expect(thresholdInput().value).toBe("6");
  });

  it("preserves a dirty edit across a same-reference rerender", () => {
    const v1 = settings(6);
    usePlatformSettings.mockReturnValue(loading());
    const { rerender } = render(<PlatformSettingsPage />);
    usePlatformSettings.mockReturnValue(loaded(v1));
    rerender(<PlatformSettingsPage />);

    // Force the wrong state relative to the server: dirty the input.
    fireEvent.change(thresholdInput(), { target: { value: "9.5" } });
    expect(thresholdInput().value).toBe("9.5");

    // Same settings ref → guard sees `settings === prevSettings`, does not
    // re-seed; the dirty edit survives.
    usePlatformSettings.mockReturnValue(loaded(v1));
    rerender(<PlatformSettingsPage />);
    expect(thresholdInput().value).toBe("9.5");
  });

  it("re-seeds when a refetch produces a new settings object", () => {
    const v1 = settings(6);
    usePlatformSettings.mockReturnValue(loading());
    const { rerender } = render(<PlatformSettingsPage />);
    usePlatformSettings.mockReturnValue(loaded(v1));
    rerender(<PlatformSettingsPage />);

    fireEvent.change(thresholdInput(), { target: { value: "9.5" } });
    expect(thresholdInput().value).toBe("9.5");

    // Refetch: NEW object identity with a different server value → the
    // render-time guard re-seeds, discarding the local edit.
    usePlatformSettings.mockReturnValue(loaded(settings(7)));
    rerender(<PlatformSettingsPage />);
    expect(thresholdInput().value).toBe("7");
  });
});
