/**
 * Tests for `QuotaInline` rendering branches: admin-bypass, normal,
 * threshold warning, and exhausted-suppress. The component reads the
 * cached caller quota; the hook is mocked so this stays focused on
 * render behavior.
 *
 * @module components/quota/QuotaInline.test
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuotaSnapshot, SurfaceSnapshot } from "@/services/quotaApi";

const useMyQuota = vi.fn();

vi.mock("@/hooks/useQuota", () => ({
  useMyQuota: () => useMyQuota(),
}));

import { QuotaInline } from "./QuotaInline";

function surface(overrides: Partial<SurfaceSnapshot> = {}): SurfaceSnapshot {
  return {
    defaultAllotment: 200,
    adminGrant: 0,
    used: 10,
    remaining: 190,
    warningThreshold: 0.8,
    warning: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SurfaceSnapshot> = {}): QuotaSnapshot {
  const playground = surface(overrides);
  return {
    isAdmin: false,
    monthMarker: "2026-05",
    monthStart: "2026-05-01T00:00:00.000Z",
    monthEnd: "2026-06-01T00:00:00.000Z",
    nextMonthlyResetAt: "2026-06-01T00:00:00.000Z",
    playground,
    skillGen: surface({ defaultAllotment: 20, remaining: 18, used: 2 }),
  };
}

describe("QuotaInline", () => {
  it("renders an unlimited stamp for admins", () => {
    useMyQuota.mockReturnValue({ data: { ...snapshot(), isAdmin: true } });
    render(<QuotaInline surface="playground" />);
    expect(
      screen.getByRole("status", { name: /admin — quota unlimited/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/unlimited playground/i)).toBeInTheDocument();
  });

  it("shows compact stamp under threshold", () => {
    useMyQuota.mockReturnValue({ data: snapshot() });
    render(<QuotaInline surface="playground" />);
    expect(screen.getByText(/playground left/i)).toBeInTheDocument();
  });

  it("renders the warning banner at warning threshold", () => {
    useMyQuota.mockReturnValue({
      data: snapshot({
        warning: true,
        used: 160,
        remaining: 40,
      }),
    });
    render(<QuotaInline surface="playground" />);
    expect(screen.getByText(/80% used this month/i)).toBeInTheDocument();
  });

  it("renders nothing when surface is exhausted (over-limit page takes over)", () => {
    useMyQuota.mockReturnValue({
      data: snapshot({
        used: 200,
        remaining: 0,
      }),
    });
    const { container } = render(<QuotaInline surface="playground" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the admin-grant additive when one is active", () => {
    useMyQuota.mockReturnValue({
      data: snapshot({ adminGrant: 5, remaining: 195 }),
    });
    render(<QuotaInline surface="playground" />);
    expect(screen.getByText(/\+5 grant/i)).toBeInTheDocument();
  });
});
