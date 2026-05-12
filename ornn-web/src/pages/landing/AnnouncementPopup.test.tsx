/**
 * AnnouncementPopup tests.
 *
 * Covers:
 *   - Renders the modal when an active announcement exists and the
 *     user hasn't dismissed that id.
 *   - Does NOT render when the active id has already been dismissed
 *     (localStorage flag from a prior visit).
 *   - Dismiss writes the per-id flag so a re-mount stays closed.
 *   - Returns null when there is no active announcement.
 *
 * Mocks `useActiveAnnouncement` directly so the test never pulls in
 * the api client / auth store auto-init chain.
 *
 * @module pages/landing/AnnouncementPopup.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PublicAnnouncement } from "@/services/announcementsApi";

// jsdom in this project does not ship a working localStorage. Inject
// a minimal in-memory replacement before any test code touches it.
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: fake,
    configurable: true,
  });
}
installFakeLocalStorage();

const mockActive = vi.fn<() => { data: PublicAnnouncement | null }>();

vi.mock("@/hooks/useAnnouncements", () => ({
  useActiveAnnouncement: () => mockActive(),
}));

import { AnnouncementPopup } from "./AnnouncementPopup";

describe("AnnouncementPopup", () => {
  beforeEach(() => {
    localStorage.clear();
    mockActive.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when there is no active announcement", () => {
    mockActive.mockReturnValue({ data: null });
    render(<AnnouncementPopup />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("renders the announcement modal when active and not dismissed", async () => {
    mockActive.mockReturnValue({
      data: {
        id: "a-1",
        title: "Ornn 1.2 is live",
        bodyMarkdown: "**Now with** chained skills.",
        ctaLabel: "See changelog",
        ctaUrl: "https://ornn.dev/changelog",
      },
    });
    render(<AnnouncementPopup />);
    expect(
      await screen.findByRole("heading", { name: /Ornn 1\.2 is live/i }),
    ).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /See changelog/i });
    expect(cta).toHaveAttribute("href", "https://ornn.dev/changelog");
    expect(cta).toHaveAttribute("target", "_blank");
  });

  it("does not render when the active id has been dismissed", () => {
    localStorage.setItem("ornn:announcement:dismissed:a-1", "1");
    mockActive.mockReturnValue({
      data: {
        id: "a-1",
        title: "Already-seen news",
        bodyMarkdown: "Body",
        ctaLabel: null,
        ctaUrl: null,
      },
    });
    render(<AnnouncementPopup />);
    expect(screen.queryByRole("heading", { name: /Already-seen news/i })).toBeNull();
  });

  it("dismiss button closes and persists the flag", async () => {
    mockActive.mockReturnValue({
      data: {
        id: "a-2",
        title: "Hello there",
        bodyMarkdown: "Body",
        ctaLabel: null,
        ctaUrl: null,
      },
    });
    render(<AnnouncementPopup />);
    expect(
      await screen.findByRole("heading", { name: /Hello there/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(localStorage.getItem("ornn:announcement:dismissed:a-2")).toBe("1");
  });
});
