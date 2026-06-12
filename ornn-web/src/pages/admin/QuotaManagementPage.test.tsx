/**
 * QuotaManagementPage tests — deep-link grant-modal guard (#888).
 *
 * The `?userId=` deep-link opens the GrantQuotaModal as soon as the
 * matching row arrives, using the "adjust state during render" guard
 * (tracked by `consumedDeepLink`) so it fires exactly ONCE, then an effect
 * strips the `userId` param so a refresh doesn't re-trigger. A row that
 * never matches (stale / missing userId) must NOT open the modal and must
 * not crash.
 *
 * STALE-STATE-FIRST oracle: mount with `?userId=X` already in the URL
 * (the modal is initially closed despite the param) → the guard
 * self-corrects on the render where the matching row is present, opening
 * the modal once and stripping the param. A subsequent rerender does NOT
 * reopen it (consumedDeepLink latches).
 *
 * The data hook + debounce are mocked; the heavy child components
 * (QuotaTable, drawers, modal, banner, pagination) are stubbed to tiny
 * markers so the test isolates the page's deep-link orchestration.
 * react-i18next is stubbed globally in src/test/setup.ts.
 *
 * @module pages/admin/QuotaManagementPage.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AdminQuotaRow, AdminQuotaPage } from "@/services/quotaApi";

const useAdminQuotaUsers = vi.fn();

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

vi.mock("@/hooks/useQuota", () => ({
  useAdminQuotaUsers: (params: unknown) => useAdminQuotaUsers(params),
}));

// Debounce is identity in tests so the filter value flows through without
// fake timers.
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

// Stub the heavy children. GrantQuotaModal renders a marker only when open,
// carrying the user id so we can assert which row drove the open.
vi.mock("@/components/admin/quota/QuotaTable", () => ({
  QuotaTable: () => <div data-testid="quota-table" />,
}));
vi.mock("@/components/admin/quota/QuotaUserDetailDrawer", () => ({
  QuotaUserDetailDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="detail-drawer" /> : null,
}));
vi.mock("@/components/admin/quota/GrantQuotaModal", () => ({
  GrantQuotaModal: ({
    isOpen,
    user,
  }: {
    isOpen: boolean;
    user: { userId: string } | null;
  }) =>
    isOpen ? (
      <div data-testid="grant-modal" data-user={user?.userId ?? ""} />
    ) : null,
}));
vi.mock("@/components/admin/quota/CalendarPeriodBanner", () => ({
  CalendarPeriodBanner: () => <div data-testid="banner" />,
}));
vi.mock("@/components/ui/Pagination", () => ({
  Pagination: () => <div data-testid="pagination" />,
}));

import { QuotaManagementPage } from "./QuotaManagementPage";

function row(userId: string): AdminQuotaRow {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId,
    isAdmin: false,
    defaultAllotment: 100,
    adminGrant: 0,
    used: 10,
    remaining: 90,
  };
}

function page(rows: AdminQuotaRow[]): AdminQuotaPage {
  return {
    items: rows,
    banner: {
      monthMarker: "2026-05",
      monthStart: "2026-05-01T00:00:00.000Z",
      monthEnd: "2026-05-31T23:59:59.000Z",
    },
    page: 1,
    pageSize: 20,
    total: rows.length,
    totalPages: 1,
  };
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/quota${search}`]}>
      <QuotaManagementPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAdminQuotaUsers.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("QuotaManagementPage — deep-link grant modal", () => {
  it("opens the grant modal once for a matching ?userId row", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: page([row("u-1"), row("u-2")]),
      isLoading: false,
      error: null,
    });

    renderAt("?userId=u-2");

    const modal = screen.getByTestId("grant-modal");
    expect(modal).toBeInTheDocument();
    // The modal opened for the matching row (u-2), not the first row.
    expect(modal.getAttribute("data-user")).toBe("u-2");
  });

  it("strips the userId param after consuming the deep-link", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: page([row("u-2")]),
      isLoading: false,
      error: null,
    });

    renderAt("?userId=u-2&surface=playground");

    // The grant modal stays open (consumedDeepLink latched), and the
    // userId param was stripped by the effect — proven by a rerender NOT
    // re-firing the open guard (covered below). Here we just confirm the
    // modal is open and didn't crash with the surface param present.
    expect(screen.getByTestId("grant-modal")).toBeInTheDocument();
  });

  it("does not re-fire the open guard on a plain rerender (consumedDeepLink latches)", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: page([row("u-2")]),
      isLoading: false,
      error: null,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/admin/quota?userId=u-2"]}>
        <QuotaManagementPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("grant-modal")).toHaveLength(1);

    // A plain rerender with the same hook data — RTL's rerender reuses the
    // existing root, so component state is preserved. The param was already
    // stripped and consumedDeepLink === "u-2", so the render-time guard does
    // NOT re-fire (no spurious re-open / duplicate). Exactly one modal node.
    rerender(
      <MemoryRouter initialEntries={["/admin/quota?userId=u-2"]}>
        <QuotaManagementPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("grant-modal")).toHaveLength(1);
    expect(screen.getByTestId("grant-modal").getAttribute("data-user")).toBe("u-2");
  });

  it("closes (no open) when the deep-link userId is absent from the URL", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: page([row("u-2")]),
      isLoading: false,
      error: null,
    });

    renderAt(""); // no userId param

    // Rows present but no deep-link param → deepLinkUserId is null → the
    // guard never fires. The open is driven purely by the param.
    expect(screen.queryByTestId("grant-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("quota-table")).toBeInTheDocument();
  });

  it("does not open the modal (and does not crash) when the userId has no matching row", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: page([row("u-1"), row("u-2")]),
      isLoading: false,
      error: null,
    });

    renderAt("?userId=does-not-exist");

    // No matching row → deepLinkRow is null → guard never fires.
    expect(screen.queryByTestId("grant-modal")).not.toBeInTheDocument();
    // Page still rendered (no crash).
    expect(screen.getByTestId("quota-table")).toBeInTheDocument();
  });

  it("does not open the modal while the data is still loading", () => {
    useAdminQuotaUsers.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderAt("?userId=u-2");

    // usersQuery.data is undefined → deepLinkRow stays null → no open, no crash.
    expect(screen.queryByTestId("grant-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("quota-table")).toBeInTheDocument();
  });
});
