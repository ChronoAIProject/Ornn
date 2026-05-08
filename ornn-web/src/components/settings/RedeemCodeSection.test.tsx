/**
 * Tests for `RedeemCodeSection` — covers the happy-path success
 * panel, per-error-code message mapping, and the empty-input guard
 * (which must short-circuit before any network call).
 *
 * @module components/settings/RedeemCodeSection.test
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RedeemAppliedGrant,
  RedemptionHistoryItem,
} from "@/services/redemptionCodesApi";

const redeemMutateAsync = vi.fn();
const useRedeemCode = vi.fn();
const useMyRedemptionHistory = vi.fn();

vi.mock("@/hooks/useRedemptionCodes", () => ({
  useRedeemCode: () => useRedeemCode(),
  useMyRedemptionHistory: () => useMyRedemptionHistory(),
}));

// Side-step the apiClient → authStore → zustand persist chain (needs
// jsdom localStorage at import time). The component uses
// `instanceof ApiClientError`; the stub below is the class
// `instanceof` will check against in tests. Defined inside the factory
// because `vi.mock` is hoisted above any module-scope declarations.
vi.mock("@/services/apiClient", () => {
  class StubApiClientError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.name = "ApiClientError";
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return { ApiClientError: StubApiClientError, ApiError: StubApiClientError };
});

// Re-import the mocked class to use as the constructor in tests.
import { ApiClientError as StubApiClientError } from "@/services/apiClient";

import { RedeemCodeSection } from "./RedeemCodeSection";

function defaultGrants(): RedeemAppliedGrant[] {
  return [
    {
      surface: "playground",
      amount: 100,
      monthMarker: "2026-05",
      newAdminGrant: 100,
    },
    {
      surface: "skillGen",
      amount: 50,
      monthMarker: "2026-05",
      newAdminGrant: 50,
    },
  ];
}

beforeEach(() => {
  redeemMutateAsync.mockReset();
  useRedeemCode.mockReturnValue({
    mutateAsync: redeemMutateAsync,
    isPending: false,
  });
  useMyRedemptionHistory.mockReturnValue({
    data: { items: [], total: 0, page: 1, pageSize: 5, totalPages: 1 },
  });
});

describe("RedeemCodeSection", () => {
  it("shows the initial help text before any submit", () => {
    render(<RedeemCodeSection />);
    expect(
      screen.getByText(/got a code from the team/i),
    ).toBeInTheDocument();
  });

  it("renders the success panel with grant breakdown after a successful redeem", async () => {
    redeemMutateAsync.mockResolvedValue({
      codeId: "abc",
      redeemedAt: "2026-05-08T10:00:00.000Z",
      grants: defaultGrants(),
    });

    render(<RedeemCodeSection />);
    fireEvent.change(screen.getByLabelText(/redemption code/i), {
      target: { value: "ABC123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /redeem/i }));

    await waitFor(() => {
      expect(redeemMutateAsync).toHaveBeenCalledWith("ABC123");
    });
    expect(
      await screen.findByText(/playground \+100, skill generation \+50/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/active until end of month/i)).toBeInTheDocument();
  });

  it("rejects empty / whitespace-only input without calling the network", () => {
    render(<RedeemCodeSection />);
    const button = screen.getByRole("button", { name: /redeem/i });
    // Submit button is disabled while the trimmed value is empty so a
    // submit can't even fire — the safest possible empty-input guard.
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/redemption code/i);
    fireEvent.change(input, { target: { value: "   " } });
    expect(button).toBeDisabled();
    expect(redeemMutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["REDEMPTION_CODE_NOT_FOUND", /code not found/i],
    ["REDEMPTION_CODE_EXPIRED", /this code has expired/i],
    ["REDEMPTION_CODE_INVALIDATED", /revoked/i],
    ["REDEMPTION_CODE_ALREADY_REDEEMED", /already been used/i],
  ])("maps error code %s to the right message", async (code, pattern) => {
    redeemMutateAsync.mockRejectedValue(
      new StubApiClientError(code, "server message", 410),
    );

    render(<RedeemCodeSection />);
    fireEvent.change(screen.getByLabelText(/redemption code/i), {
      target: { value: "BAD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /redeem/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
  });

  it("falls back to the default message for unrecognized error codes", async () => {
    redeemMutateAsync.mockRejectedValue(
      new StubApiClientError("SOMETHING_ELSE", "server message", 500),
    );
    render(<RedeemCodeSection />);
    fireEvent.change(screen.getByLabelText(/redemption code/i), {
      target: { value: "BAD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /redeem/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't redeem this code/i,
    );
  });

  it("renders the recently-redeemed list when history is non-empty", () => {
    const item: RedemptionHistoryItem = {
      id: "1",
      code: "ABCD-EFGH-IJKL-MNOP",
      grants: [{ surface: "playground", amount: 25 }],
      note: null,
      redeemedAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
    };
    useMyRedemptionHistory.mockReturnValue({
      data: { items: [item], total: 1, page: 1, pageSize: 5, totalPages: 1 },
    });

    render(<RedeemCodeSection />);
    expect(screen.getByText(/recently redeemed/i)).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH-IJKL-MNOP")).toBeInTheDocument();
    expect(screen.getByText(/playground \+25/i)).toBeInTheDocument();
  });
});
