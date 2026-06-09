/**
 * LifecycleRing tests.
 *
 * Covers the disclosure behaviour of the orbital skill-lifecycle ring:
 *   - renders the rest-state hub + all eight stage nodes as labelled buttons
 *   - no detail card is shown at rest
 *   - hovering / focusing a node reveals its detail card (title, body, CTA)
 *     and flips the node's aria-expanded
 *   - clicking toggles the card open and closed
 *   - the decorative ring SVG is hidden from assistive tech
 *
 * Framer Motion is NOT mocked (matching the other landing tests); the global
 * react-i18next mock (test/setup.ts) resolves real en.json strings, so we
 * assert against the actual copy. window.matchMedia is stubbed for a
 * deterministic non-reduced-motion render.
 *
 * @module pages/landing/LifecycleRing.test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LifecycleRing } from "./LifecycleRing";
import { LIFECYCLE_STAGES } from "./lifecycleStages";

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderRing() {
  return render(
    <MemoryRouter>
      <LifecycleRing />
    </MemoryRouter>,
  );
}

describe("LifecycleRing", () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => cleanup());

  it("renders the rest-state hub and all eight stage nodes", () => {
    renderRing();
    expect(screen.getByText("Skill lifecycle")).toBeInTheDocument();

    const nodes = screen.getAllByRole("button");
    expect(nodes).toHaveLength(LIFECYCLE_STAGES.length);

    // Every stage is present as a labelled disclosure trigger.
    for (const name of ["Search", "Preview", "Audit", "Install", "Execute", "Build", "Publish", "Share"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`${name} — show details`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("shows no detail card at rest", () => {
    renderRing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reveals the stage's detail card on hover and flips aria-expanded", async () => {
    renderRing();
    const search = screen.getByRole("button", { name: /Search — show details/i });
    expect(search).toHaveAttribute("aria-expanded", "false");

    fireEvent.mouseEnter(search);

    const card = await screen.findByRole("dialog", { name: "Search" });
    expect(card).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Find the right skill/i })).toBeInTheDocument();
    expect(search).toHaveAttribute("aria-expanded", "true");

    const cta = screen.getByRole("link", { name: /Browse the registry/i });
    expect(cta).toHaveAttribute("href", "/registry");
  });

  it("reveals the card on focus", async () => {
    renderRing();
    const build = screen.getByRole("button", { name: /Build — show details/i });
    fireEvent.focus(build);
    expect(await screen.findByRole("dialog", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Build a skill/i })).toHaveAttribute("href", "/skills/new");
  });

  it("opens the card on click (tap) and keeps it open, then closes on outside click", async () => {
    renderRing();
    const publish = screen.getByRole("button", { name: /Publish — show details/i });

    fireEvent.click(publish);
    expect(await screen.findByRole("dialog", { name: "Publish" })).toBeInTheDocument();

    // A second click must NOT slam it shut (activate, never click-time toggle) —
    // this is the focus/click race that broke tap-to-open on touch.
    fireEvent.click(publish);
    expect(screen.getByRole("dialog", { name: "Publish" })).toBeInTheDocument();

    // Tapping outside the ring dismisses it.
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("switches the card when another stage is activated", async () => {
    renderRing();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Search — show details/i }));
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Install — show details/i }));
    expect(await screen.findByRole("dialog", { name: "Install" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
  });

  it("hides the decorative ring SVG from assistive tech", () => {
    const { container } = renderRing();
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
