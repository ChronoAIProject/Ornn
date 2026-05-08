/**
 * Tests for `MintRedemptionCodeModal` — covers the client-side guards
 * that mirror the backend zod (no duplicate surface, future expiry,
 * positive integer amount) and the success state where the generated
 * code becomes the only thing the modal shows.
 *
 * @module components/admin/redemption-codes/MintRedemptionCodeModal.test
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RedemptionCode } from "@/services/redemptionCodesApi";

const mintMutateAsync = vi.fn();
const useMintCode = vi.fn();
const addToast = vi.fn();

vi.mock("@/hooks/useRedemptionCodes", () => ({
  useMintCode: () => useMintCode(),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { MintRedemptionCodeModal } from "./MintRedemptionCodeModal";

function mintedCode(): RedemptionCode {
  return {
    id: "1",
    code: "ABCD-EFGH-IJKL-MNOP",
    grants: [
      { surface: "playground", amount: 100 },
      { surface: "skillGen", amount: 50 },
    ],
    note: "test",
    status: "active",
    createdAt: "2026-05-08T10:00:00.000Z",
    createdBy: { userId: "u1", email: "a@b.c", displayName: "Admin" },
    expiresAt: "2026-06-08T10:00:00.000Z",
    redeemedAt: null,
    redeemedBy: null,
    invalidatedAt: null,
    invalidatedBy: null,
  };
}

beforeEach(() => {
  mintMutateAsync.mockReset();
  addToast.mockReset();
  useMintCode.mockReturnValue({
    mutateAsync: mintMutateAsync,
    isPending: false,
  });
});

describe("MintRedemptionCodeModal", () => {
  it("rejects submit when amount is invalid (zero / non-positive)", async () => {
    render(<MintRedemptionCodeModal isOpen={true} onClose={() => {}} />);

    const amountInput = screen.getByLabelText(/grant 1 amount/i);
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^mint code$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /positive whole number/i,
    );
    expect(mintMutateAsync).not.toHaveBeenCalled();
  });

  it("disables surfaces already used in another grant row", async () => {
    render(<MintRedemptionCodeModal isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /\+ add grant/i }));

    const select1 = screen.getByLabelText(/grant 1 surface/i) as HTMLSelectElement;
    const select2 = screen.getByLabelText(/grant 2 surface/i) as HTMLSelectElement;

    // Each select only offers the surface(s) not already chosen on the other row.
    const options1 = within(select1).getAllByRole("option") as HTMLOptionElement[];
    const options2 = within(select2).getAllByRole("option") as HTMLOptionElement[];
    expect(options1.map((o) => o.value)).toEqual(["playground"]);
    expect(options2.map((o) => o.value)).toEqual(["skillGen"]);
  });

  it("blocks submission when expiresAt is in the past", async () => {
    render(<MintRedemptionCodeModal isOpen={true} onClose={() => {}} />);

    const expires = screen.getByLabelText(/expires at/i) as HTMLInputElement;
    fireEvent.change(expires, { target: { value: "2000-01-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^mint code$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /expiration must be in the future/i,
    );
    expect(mintMutateAsync).not.toHaveBeenCalled();
  });

  it("renders a copyable success state once the code is minted", async () => {
    mintMutateAsync.mockResolvedValue({ code: mintedCode() });

    render(<MintRedemptionCodeModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^mint code$/i }));

    await waitFor(() => expect(mintMutateAsync).toHaveBeenCalled());

    expect(
      await screen.findByText("ABCD-EFGH-IJKL-MNOP"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy code$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
  });
});
