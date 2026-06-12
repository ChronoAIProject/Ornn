/**
 * HeroVideo tests (#840).
 *
 * Covers:
 *   - Motion (prefers-reduced-motion: NOT set): renders the autoplaying,
 *     muted, looping background <video> with the mp4 source + poster, marked
 *     decorative (aria-hidden), plus the two CTA links.
 *   - Reduced motion (prefers-reduced-motion: reduce): renders NO <video>,
 *     only the static poster <img>.
 *
 * `window.matchMedia` is stubbed in beforeEach so the local
 * `usePrefersReducedMotion` (useSyncExternalStore) reads a deterministic
 * `matches` value. The render is wrapped in <MemoryRouter> because EmberLink
 * renders a react-router <Link>. The global react-i18next mock (test/setup.ts)
 * returns the real en.json strings, so no per-test i18n mock is needed.
 *
 * @module pages/landing/HeroVideo.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { HeroVideo } from "./HeroVideo";
// Same Vite-hashed asset URLs the component imports — assert against these
// instead of hardcoded /public paths (the assets are content-hashed for
// cache-busting, so their served URLs are not stable strings).
import introPoster from "@/assets/ornn-intro-poster.jpg";
import introVideo from "@/assets/ornn-intro.mp4";

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

function renderHero() {
  return render(
    <MemoryRouter>
      <HeroVideo />
    </MemoryRouter>,
  );
}

describe("HeroVideo", () => {
  afterEach(() => {
    cleanup();
  });

  describe("motion (prefers-reduced-motion not set)", () => {
    beforeEach(() => {
      stubMatchMedia(false);
    });

    it("renders the autoplaying muted looping background video", () => {
      const { container } = renderHero();
      const video = container.querySelector("video");
      expect(video).not.toBeNull();
      // Assert DOM properties, not attributes — these are reflected booleans.
      const el = video as HTMLVideoElement;
      expect(el.muted).toBe(true);
      expect(el.autoplay).toBe(true);
      expect(el.loop).toBe(true);
      expect(el.playsInline).toBe(true);
      expect(el.getAttribute("poster")).toBe(introPoster);
      expect(el.getAttribute("aria-hidden")).toBe("true");

      const source = el.querySelector("source");
      expect(source).not.toBeNull();
      expect(source?.getAttribute("src")).toBe(introVideo);
      expect(source?.getAttribute("type")).toBe("video/mp4");
    });

    it("renders both CTA links pointing at /registry and /skills/new", () => {
      renderHero();
      const links = screen.getAllByRole("link");
      const hrefs = links.map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("/registry");
      expect(hrefs).toContain("/skills/new");
    });
  });

  describe("reduced motion (prefers-reduced-motion: reduce)", () => {
    beforeEach(() => {
      stubMatchMedia(true);
    });

    it("renders the static poster image and no video", () => {
      const { container } = renderHero();
      expect(container.querySelector("video")).toBeNull();
      const poster = container.querySelector(`img[src="${introPoster}"]`);
      expect(poster).not.toBeNull();
    });
  });
});
