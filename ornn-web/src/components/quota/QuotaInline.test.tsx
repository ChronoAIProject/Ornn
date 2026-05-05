/**
 * Tests for `QuotaInline` rendering branches: admin-bypass, normal,
 * 80% warning, and exhausted-suppress.
 *
 * The component reads the cached caller quota — we mock the hook
 * directly so the test stays focused on render behavior.
 *
 * @module components/quota/QuotaInline.test
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuotaSnapshot } from "@/services/quotaApi";

const useMyQuota = vi.fn();

vi.mock("@/hooks/useQuota", () => ({
  useMyQuota: () => useMyQuota(),
}));

import { QuotaInline } from "./QuotaInline";

function snapshot(overrides: Partial<QuotaSnapshot["playground"]> = {}): QuotaSnapshot {
  const playground: QuotaSnapshot["playground"] = {
    monthly: { limit: 200, used: 10, remaining: 190 },
    daily: { limit: 50, used: 2, remaining: 48 },
    credits: { balance: 0 },
    warningThreshold: 0.8,
    warning: false,
    monthlyResetAt: "2026-06-01T00:00:00.000Z",
    dailyResetAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
  return {
    playground,
    skillGen: { ...playground, monthly: { ...playground.monthly, limit: 20 } },
    isAdmin: false,
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

  it("renders the warning banner at 80%+", () => {
    useMyQuota.mockReturnValue({
      data: snapshot({
        warning: true,
        monthly: { limit: 200, used: 160, remaining: 40 },
      }),
    });
    render(<QuotaInline surface="playground" />);
    expect(screen.getByText(/80% used/i)).toBeInTheDocument();
  });

  it("renders nothing when surface is exhausted (over-limit page takes over)", () => {
    useMyQuota.mockReturnValue({
      data: snapshot({
        monthly: { limit: 200, used: 200, remaining: 0 },
      }),
    });
    const { container } = render(<QuotaInline surface="playground" />);
    expect(container.firstChild).toBeNull();
  });
});
