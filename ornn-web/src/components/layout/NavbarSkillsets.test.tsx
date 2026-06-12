/**
 * Navbar — the Skillsets nav entry (#1059).
 *
 * The top nav must expose a "Skillsets" link pointing at `/skillsets`,
 * sitting alongside the existing Registry entry. It is a public link
 * (no auth gate), so it renders for anonymous visitors too.
 *
 * The auth/theme/activity/bell deps are mocked exactly as in Navbar.test.tsx
 * so the component renders without the apiClient/auth init chain. react-i18next
 * is stubbed globally in src/test/setup.ts (the "Skillsets" label resolves from
 * en.json `nav.skillsets`).
 *
 * @module components/layout/NavbarSkillsets.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => ({}), { getState: () => ({ logout: vi.fn() }) }),
  useIsAuthenticated: () => false,
  useCurrentUser: () => null,
}));

vi.mock("@/stores/themeStore", () => ({
  useThemeStore: () => ({ theme: "dark", toggle: vi.fn() }),
}));

vi.mock("@/services/activityApi", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));

import { Navbar } from "./Navbar";

afterEach(() => cleanup());

describe("Navbar — Skillsets entry", () => {
  it("renders a 'Skillsets' link pointing at /skillsets", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Navbar />
      </MemoryRouter>,
    );
    // Two surfaces (desktop strip + mobile panel) each render the link.
    const links = screen.getAllByRole("link", { name: "Skillsets" });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link).toHaveAttribute("href", "/skillsets"));
  });

  it("still renders the existing Registry link (Skillsets is additive)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Navbar />
      </MemoryRouter>,
    );
    const registry = screen.getAllByRole("link", { name: "Registry" });
    expect(registry.length).toBeGreaterThan(0);
    registry.forEach((link) => expect(link).toHaveAttribute("href", "/registry"));
  });
});
