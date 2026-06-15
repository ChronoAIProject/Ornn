/**
 * TransferOwnershipModal tests (#1123).
 *
 * Guards the two-step safety flow: a target must be picked from the
 * directory AND the skill name typed exactly before the transfer can fire,
 * and the mutation is called with the selected user's id.
 *
 * Directory search + mutation + toast are mocked; framer-motion (Modal
 * AnimatePresence) is stubbed; react-i18next is global.
 *
 * @module components/skill/TransferOwnershipModal.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillDetail } from "@/types/domain";

const mutateAsync = vi.fn();
const addToast = vi.fn();
const searchUsersByEmail = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const Comp: React.FC<Record<string, unknown> & { children?: React.ReactNode }> = ({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          ...rest
        }) => {
          void _i; void _a; void _e; void _tr;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        };
        return Comp;
      },
    },
  ),
}));

vi.mock("@/hooks/useSkills", () => ({
  useTransferSkillOwnership: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) => selector({ addToast }),
}));

vi.mock("@/services/usersApi", () => ({
  searchUsersByEmail: (...args: unknown[]) => searchUsersByEmail(...args),
}));

import { TransferOwnershipModal } from "./TransferOwnershipModal";

function skill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    guid: "skill-guid",
    name: "demo-skill",
    description: "",
    createdBy: "owner-1",
    createdOn: "2026-05-01T00:00:00.000Z",
    isPrivate: true,
    tags: [],
    updatedOn: "2026-05-01T00:00:00.000Z",
    presignedPackageUrl: "",
    metadata: {},
    version: "1.0",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    ...overrides,
  } as SkillDetail;
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransferOwnershipModal isOpen onClose={() => {}} skill={skill()} />
    </QueryClientProvider>,
  );
}

const transferButton = () => screen.getByRole("button", { name: /^transfer ownership$/i });

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ skill: skill({ createdBy: "alice-id" }) });
  addToast.mockReset();
  searchUsersByEmail.mockReset().mockResolvedValue([
    { userId: "alice-id", email: "alice@x.io", displayName: "Alice" },
  ]);
});

afterEach(() => cleanup());

describe("TransferOwnershipModal", () => {
  it("disables transfer until a target is picked and the name is confirmed", async () => {
    renderModal();
    expect(transferButton()).toBeDisabled();

    // Pick a target from the directory typeahead.
    fireEvent.focus(screen.getByPlaceholderText(/type an email/i));
    fireEvent.change(screen.getByPlaceholderText(/type an email/i), { target: { value: "al" } });
    const suggestion = await screen.findByText("Alice");
    fireEvent.mouseDown(suggestion);

    // Target chosen but name not yet typed → still disabled.
    expect(transferButton()).toBeDisabled();

    // Type the WRONG name → still disabled.
    const confirmInput = screen.getByPlaceholderText("demo-skill");
    fireEvent.change(confirmInput, { target: { value: "wrong-name" } });
    expect(transferButton()).toBeDisabled();

    // Type the exact name → enabled.
    fireEvent.change(confirmInput, { target: { value: "demo-skill" } });
    expect(transferButton()).not.toBeDisabled();
  });

  it("fires the mutation with the selected user id on confirm", async () => {
    renderModal();
    fireEvent.focus(screen.getByPlaceholderText(/type an email/i));
    fireEvent.change(screen.getByPlaceholderText(/type an email/i), { target: { value: "al" } });
    fireEvent.mouseDown(await screen.findByText("Alice"));
    fireEvent.change(screen.getByPlaceholderText("demo-skill"), { target: { value: "demo-skill" } });

    fireEvent.click(transferButton());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("alice-id"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
  });
});
