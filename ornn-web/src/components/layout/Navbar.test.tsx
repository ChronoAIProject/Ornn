/**
 * Navbar tests — close-menu-on-navigation guard (#888).
 *
 * The mobile menu (and user menu) close on route change via the "adjust
 * state during render" pattern: the component tracks the previous
 * `location.pathname` and, when it differs from the current one, flips
 * both menus shut during render — no route-change effect. Critically a
 * rerender that does NOT change the path must leave an open menu OPEN.
 *
 * STALE-STATE-FIRST oracle: open the mobile menu (force the "wrong" state
 * for a fresh route), then drive a route change → the render-time guard
 * self-corrects and the menu closes. Contrast: a same-path rerender keeps
 * it open.
 *
 * The toggle button exposes `aria-expanded` and the panel carries
 * `data-open`, so both are observable without poking internal state.
 *
 * Auth/theme stores, activity logging and the notification bell are mocked
 * so the test renders an anonymous navbar without the apiClient / auth
 * init chain. react-i18next is stubbed globally in src/test/setup.ts.
 *
 * @module components/layout/Navbar.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

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
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

// Anonymous session — keeps NotificationBell + user-menu groups out of the
// tree and dodges the apiClient/auth init chain.
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({ logout: vi.fn() }),
  }),
  useIsAuthenticated: () => false,
  useCurrentUser: () => null,
}));

vi.mock("@/stores/themeStore", () => ({
  useThemeStore: () => ({ theme: "dark", toggle: vi.fn() }),
}));

vi.mock("@/services/activityApi", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

import { Navbar } from "./Navbar";

/**
 * Harness with a button that programmatically navigates, so we can trigger
 * a real router location change from within the same Router as the Navbar.
 */
function Nav({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <>
      <Navbar />
      <button type="button" data-testid="go" onClick={() => navigate(to)}>
        go
      </button>
    </>
  );
}

function mobileToggle(): HTMLButtonElement {
  // The hamburger toggle is the button carrying aria-expanded (md:hidden).
  return screen
    .getAllByRole("button")
    .find((b) => b.hasAttribute("aria-expanded")) as HTMLButtonElement;
}

function mobilePanel(): HTMLElement {
  return document.getElementById("app-mobile-nav-panel") as HTMLElement;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Navbar — menu closes on navigation", () => {
  it("opens the mobile menu on toggle click", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Nav to="/news" />
      </MemoryRouter>,
    );

    const toggle = mobileToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(mobilePanel().getAttribute("data-open")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(mobilePanel().getAttribute("data-open")).toBe("true");
  });

  it("closes the open menu when the route changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Nav to="/news" />
      </MemoryRouter>,
    );

    // Force the wrong state: open the menu, then navigate to a new path.
    fireEvent.click(mobileToggle());
    expect(mobilePanel().getAttribute("data-open")).toBe("true");

    fireEvent.click(screen.getByTestId("go")); // navigate "/" → "/news"

    // The render-time prevPath guard self-corrects: the menu is now closed.
    expect(mobileToggle().getAttribute("aria-expanded")).toBe("false");
    expect(mobilePanel().getAttribute("data-open")).toBe("false");
  });

  it("does NOT close the menu on a same-path navigation/rerender", () => {
    render(
      <MemoryRouter initialEntries={["/news"]}>
        <Nav to="/news" />
      </MemoryRouter>,
    );

    fireEvent.click(mobileToggle());
    expect(mobilePanel().getAttribute("data-open")).toBe("true");

    // Navigate to the SAME path — location.pathname is unchanged, so the
    // prevPath guard must not fire and the open menu survives the rerender.
    fireEvent.click(screen.getByTestId("go")); // "/news" → "/news"
    expect(mobilePanel().getAttribute("data-open")).toBe("true");
    expect(mobileToggle().getAttribute("aria-expanded")).toBe("true");
  });
});
