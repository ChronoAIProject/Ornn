/**
 * NotificationBell tests — refetch-on-open guard (#751).
 *
 * The list query (useNotifications) stays mounted in the navbar forever
 * and never remounts; the badge (useUnreadNotificationCount) polls on its
 * own 30s tick. So a fresh broadcast bumps the badge while the dropdown
 * still renders the stale cached list until the next poll — #728 was an
 * incomplete fix. The fix: an `open`-keyed effect calls `refetch()` on
 * each false→true open transition.
 *
 * STALE-STATE-FIRST oracle: mount the bell closed (one initial fetch),
 * then open it and assert the list query fires AGAIN (Test 1). Test 2
 * resolves an UPDATED list on the open-time refetch and asserts the new
 * broadcast's text renders in the popover — proving the list is not stale
 * on open.
 *
 * Harness notes:
 *  - The auth store is mocked authed=true (so the query is `enabled`) and
 *    to dodge the persist-middleware localStorage init chain on module
 *    load (same trap useSkills.test.tsx / MirrorPage.test.tsx sidestep).
 *  - notificationsApi is mocked so we count list fetches deterministically.
 *  - framer-motion is collapsed to plain tags so the popover content is
 *    synchronously present once `open` flips (no enter/exit animation gate).
 *  - react-i18next is stubbed globally in src/test/setup.ts.
 *  - Timers are NOT advanced — we never assert on the 30s interval.
 *
 * @module components/notifications/NotificationBell.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Notification } from "@/types/notifications";

// Authed=true so useNotifications/useUnreadNotificationCount are enabled.
// Object.assign gives the store a `getState` for any incidental callers
// while the named selector hooks return fixed values.
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({
      accessToken: null,
      isAuthenticated: true,
      ensureFreshToken: async () => {},
      refreshToken: async () => {},
    }),
  }),
  useIsAuthenticated: () => true,
  useCurrentUser: () => null,
}));

// Collapse motion wrappers to plain tags so popover content is present
// synchronously once `open` flips — no animation gate to await.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
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
        }: Record<string, unknown> & { children?: ReactNode }) => {
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

vi.mock("@/services/notificationsApi", () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import { fetchNotifications, fetchUnreadCount } from "@/services/notificationsApi";
import { NotificationBell } from "./NotificationBell";

const fetchNotificationsMock = vi.mocked(fetchNotifications);
const fetchUnreadCountMock = vi.mocked(fetchUnreadCount);

function broadcast(id: string, en: string): Notification {
  return {
    _id: id,
    source: "broadcast",
    titleI18n: { en, zh: en },
    bodyMarkdownI18n: { en: `Body ${en}`, zh: `Body ${en}` },
    createdAt: "2026-06-08T00:00:00.000Z",
    readAt: null,
  };
}

/** Fresh client per test so cache + refetch state never leak across cases. */
function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The bell toggle carries aria-label "Notifications" (from the i18n key). */
function bellToggle(): HTMLButtonElement {
  return screen.getByLabelText("Notifications") as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchUnreadCountMock.mockResolvedValue(1);
});

afterEach(() => {
  cleanup();
});

describe("NotificationBell — refetch on open (#751)", () => {
  it("refetches the list when the dropdown is opened", async () => {
    fetchNotificationsMock.mockResolvedValue([broadcast("n-1", "First broadcast")]);

    renderBell();

    // Mount fires the initial list fetch exactly once.
    await waitFor(() => expect(fetchNotificationsMock).toHaveBeenCalledTimes(1));

    // Open the dropdown → the open-keyed effect refetches the list.
    fireEvent.click(bellToggle());

    await waitFor(() => expect(fetchNotificationsMock).toHaveBeenCalledTimes(2));
  });

  it("shows a newly-broadcast item that arrived after mount when opened", async () => {
    // First fetch (mount): only the old item. The refetch fired by opening
    // resolves the updated list including the new broadcast.
    fetchNotificationsMock
      .mockResolvedValueOnce([broadcast("n-1", "Old broadcast")])
      .mockResolvedValue([
        broadcast("n-2", "Fresh broadcast"),
        broadcast("n-1", "Old broadcast"),
      ]);

    renderBell();

    await waitFor(() => expect(fetchNotificationsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(bellToggle());

    // The refetch-on-open delivers the fresh item into the open popover —
    // proving the list is not stale on open.
    expect(await screen.findByText("Fresh broadcast")).toBeInTheDocument();
    expect(screen.getByText("Old broadcast")).toBeInTheDocument();
  });
});
