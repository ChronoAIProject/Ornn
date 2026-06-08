/**
 * GrantQuotaModal tests — open/close reset cycle.
 *
 * Pins the `key={isOpen ? "open" : "closed"}` remount on GrantQuotaForm
 * (#888). The form's amount/note/error state lives inside the inner
 * component; keying it on the open flag means closing then reopening the
 * modal hands back a freshly-mounted form with default values — no reset
 * effect, no leaked edits from a prior session.
 *
 * Mocks the grant mutation hook + toast store directly so the test stays
 * off the apiClient / auth-store init chain (house style — see the
 * BroadcastEditDrawer test).
 *
 * @module components/admin/quota/GrantQuotaModal.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const grantMutateAsync = vi.fn();
const useGrantQuota = vi.fn();
const addToast = vi.fn();

vi.mock("@/hooks/useQuota", () => ({
  useGrantQuota: () => useGrantQuota(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

// Strip Framer Motion so AnimatePresence honours unmounting synchronously.
// In jsdom the real AnimatePresence keeps an exiting subtree mounted (the
// exit animation never resolves without rAF), which would mask the
// open/close remount we're pinning. The plain pass-throughs make the
// `{isOpen && ...}` toggle a real mount / unmount.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          // Drop animation-only props so they don't leak onto the DOM node.
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          whileHover: _wh,
          whileTap: _wt,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          void _wh;
          void _wt;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

import { GrantQuotaModal } from "./GrantQuotaModal";

const USER = {
  userId: "user-1",
  email: "dev@example.com",
  displayName: "Dev One",
};

function amountInput(): HTMLInputElement {
  // The amount field is the only `type="number"` input in the form.
  return screen
    .getAllByRole("spinbutton")
    .find((el) => (el as HTMLInputElement).type === "number") as HTMLInputElement;
}

beforeEach(() => {
  grantMutateAsync.mockReset();
  addToast.mockReset();
  useGrantQuota.mockReturnValue({
    mutateAsync: grantMutateAsync,
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("GrantQuotaModal", () => {
  it("resets the amount field to its default after a close/reopen cycle", () => {
    const { rerender } = render(
      <GrantQuotaModal
        isOpen
        onClose={() => {}}
        surface="playground"
        user={USER}
      />,
    );

    // Default seed is "10".
    expect(amountInput().value).toBe("10");

    // Edit the field…
    fireEvent.change(amountInput(), { target: { value: "999" } });
    expect(amountInput().value).toBe("999");

    // Close the modal (form unmounts under the closed key).
    rerender(
      <GrantQuotaModal
        isOpen={false}
        onClose={() => {}}
        surface="playground"
        user={USER}
      />,
    );

    // Reopen — the form remounts under the "open" key, so the edit is gone
    // and the default value is back.
    rerender(
      <GrantQuotaModal
        isOpen
        onClose={() => {}}
        surface="playground"
        user={USER}
      />,
    );

    expect(amountInput().value).toBe("10");
  });
});
