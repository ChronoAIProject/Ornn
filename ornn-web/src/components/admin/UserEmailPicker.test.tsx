/**
 * UserEmailPicker tests — happy-path search + chip add/remove.
 *
 * Mocks `fetchAdminUsers` directly so the test stays off the apiClient
 * / auth-store chain. React Query is wrapped in a small Provider per
 * test so each `useQuery` actually executes its `queryFn`.
 *
 * @module components/admin/UserEmailPicker.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AdminUserRow, AdminUsersPage } from "@/services/adminUsersApi";

const fetchAdminUsers = vi.fn<
  (params: unknown) => Promise<AdminUsersPage>
>();

vi.mock("@/services/adminUsersApi", () => ({
  fetchAdminUsers: (params: unknown) => fetchAdminUsers(params),
}));

// Bypass the 300 ms debounce so the test doesn't have to fake timers.
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(v: T) => v,
}));

import { UserEmailPicker } from "./UserEmailPicker";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function page(rows: AdminUserRow[]): AdminUsersPage {
  return {
    items: rows,
    total: rows.length,
    page: 1,
    pageSize: rows.length,
    totalPages: 1,
  };
}

beforeEach(() => {
  fetchAdminUsers.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UserEmailPicker", () => {
  it("shows matching users in a dropdown and adds a chip on click", async () => {
    fetchAdminUsers.mockResolvedValue(
      page([
        {
          userId: "u-1",
          email: "alice@example.com",
          displayName: "Alice",
          skillCount: 0,
          lastActiveAt: null,
          activityCount: 0,
          firstJoinedAt: null,
        },
      ]),
    );

    const onChange = vi.fn();
    wrap(<UserEmailPicker value={[]} onChange={onChange} />);

    const search = screen.getByRole("textbox");
    fireEvent.change(search, { target: { value: "alice" } });

    const row = await screen.findByText("alice@example.com");
    fireEvent.click(row);

    expect(onChange).toHaveBeenCalledWith(["u-1"]);
  });

  it("renders selected chips with email labels and removes on × click", async () => {
    fetchAdminUsers.mockResolvedValue(
      page([
        {
          userId: "u-1",
          email: "alice@example.com",
          displayName: "Alice",
          skillCount: 0,
          lastActiveAt: null,
          activityCount: 0,
          firstJoinedAt: null,
        },
      ]),
    );

    const onChange = vi.fn();
    wrap(<UserEmailPicker value={["u-1"]} onChange={onChange} />);

    // Chip resolves to email via cached admin-users page.
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });

    // The × remove button — exactly one in the chip row.
    const removeBtn = screen.getByRole("button");
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
