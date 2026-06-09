/**
 * AnnouncementBanner tests.
 *
 * Covers the aggregated, dismissable, global banner:
 *   - collapsed headline pill (hardcoded launch is always a candidate)
 *   - expand reveals the stacked cards (launch + dynamic)
 *   - `+N` counter reflects extra items
 *   - per-item dismiss persists and removes the item; empty → renders nothing
 *
 * `usePublicAnnouncements` is mocked so the test never hits the api client.
 * A minimal in-memory localStorage + a matchMedia stub are installed (jsdom
 * ships neither here). The global react-i18next mock resolves real en.json
 * strings, so assertions use the actual copy.
 *
 * @module components/announcements/AnnouncementBanner.test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { PublicAnnouncementListItem } from "@/services/announcementsApi";

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
}
installFakeLocalStorage();

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const mockList = vi.fn<() => { data: PublicAnnouncementListItem[] | undefined }>();
vi.mock("@/hooks/useAnnouncements", () => ({
  usePublicAnnouncements: () => mockList(),
}));

import { AnnouncementBanner } from "./AnnouncementBanner";

const LAUNCH_DISMISS_KEY = "ornn:announcement:dismissed:launch-2026-05-13";

function dynamicItem(over: Partial<PublicAnnouncementListItem> = {}): PublicAnnouncementListItem {
  return {
    id: "a-1",
    titleEn: "v0.10.2 shipped",
    titleZh: "",
    bodyMarkdownEn: "Bug fixes and polish.",
    bodyMarkdownZh: "",
    ctaLabelEn: null,
    ctaLabelZh: null,
    ctaUrl: null,
    publishedAt: "2026-06-07T00:00:00Z",
    ...over,
  };
}

describe("AnnouncementBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    mockList.mockReset();
    mockList.mockReturnValue({ data: [] });
  });
  afterEach(() => cleanup());

  it("shows the launch headline pill collapsed by default", () => {
    render(<AnnouncementBanner />);
    expect(screen.getByRole("button", { name: /Free launch credits/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // collapsed → panel content not yet rendered
    expect(screen.queryByText("[§ ANNOUNCEMENTS]")).toBeNull();
  });

  it("expands on click and shows the launch card", () => {
    render(<AnnouncementBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Free launch credits/i }));
    expect(screen.getByText("[§ ANNOUNCEMENTS]")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Star on GitHub/i })).toBeInTheDocument();
  });

  it("counts and lists dynamic announcements alongside the launch item", () => {
    mockList.mockReturnValue({ data: [dynamicItem()] });
    render(<AnnouncementBanner />);
    expect(screen.getByText("+1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Free launch credits/i }));
    expect(screen.getByRole("heading", { name: /v0\.10\.2 shipped/i })).toBeInTheDocument();
  });

  it("dismisses an item and hides the banner once empty", async () => {
    render(<AnnouncementBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Free launch credits/i }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(localStorage.getItem(LAUNCH_DISMISS_KEY)).toBe("1");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Free launch credits/i })).toBeNull(),
    );
  });

  it("renders nothing when launch is dismissed and there are no dynamic items", () => {
    localStorage.setItem(LAUNCH_DISMISS_KEY, "1");
    render(<AnnouncementBanner />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
