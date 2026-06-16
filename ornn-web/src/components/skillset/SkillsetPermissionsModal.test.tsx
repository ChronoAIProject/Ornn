/**
 * SkillsetPermissionsModal — save wiring + skills-modal isolation.
 *
 * This modal is a DUPLICATE of the skills PermissionsModal, bound to
 * `SkillsetDetail` + `useUpdateSkillsetPermissions`. We assert:
 *   - Save calls the SKILLSET permissions mutation with the desired ACL state
 *     (here: flip a private skillset to public).
 *   - It uses `useUpdateSkillsetPermissions` (skillset hook), never the skills
 *     `useUpdateSkillPermissions` — the two surfaces must not cross-wire.
 *
 * The user directory + org hooks are stubbed so no network runs.
 *
 * @module components/skillset/SkillsetPermissionsModal.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateSkillsetPermissions = vi.fn().mockResolvedValue(undefined);
const useUpdateSkillsetPermissions = vi.fn(() => ({
  mutateAsync: updateSkillsetPermissions,
  isPending: false,
}));

vi.mock("@/hooks/useSkillsets", () => ({
  useUpdateSkillsetPermissions: (...a: unknown[]) => useUpdateSkillsetPermissions(...a),
}));

// Guard rail: if this module ever imported the skills permissions hook, the
// mock would record it — we assert it never gets called.
const useUpdateSkillPermissions = vi.fn();
vi.mock("@/hooks/useSkills", () => ({
  useUpdateSkillPermissions: (...a: unknown[]) => useUpdateSkillPermissions(...a),
}));

vi.mock("@/hooks/useMe", () => ({ useMyOrgs: () => ({ data: [] }) }));
vi.mock("@/services/usersApi", () => ({
  searchUsersByEmail: vi.fn().mockResolvedValue([]),
  resolveUsers: vi.fn().mockResolvedValue([]),
  fetchOrgSummary: vi.fn().mockResolvedValue(null),
}));

const addToast = vi.fn();
vi.mock("@/stores/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast }),
}));

vi.mock("@/utils/translateError", () => ({ translateError: (e: unknown) => String(e) }));

// Render the Modal children inline.
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SkillsetPermissionsModal } from "./SkillsetPermissionsModal";
import type { SkillsetDetail } from "@/types/skillset";

const PRIVATE_SET: SkillsetDetail = {
  guid: "g-1",
  name: "research-bundle",
  description: "d",
  instructions: "i",
  kind: "generic",
  tags: [],
  members: ["a@1.0", "b@1.0"],
  version: "1.0",
  latestVersion: "1.0",
  isPrivate: true,
  createdBy: "user-1",
  sharedWithUsers: [],
  sharedWithOrgs: [],
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-01T00:00:00.000Z",
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsetPermissionsModal", () => {
  it("binds to the SKILLSET permissions hook (guid + name), never the skills hook", () => {
    wrap(<SkillsetPermissionsModal isOpen onClose={() => {}} skillset={PRIVATE_SET} />);
    expect(useUpdateSkillsetPermissions).toHaveBeenCalledWith("g-1", "research-bundle");
    expect(useUpdateSkillPermissions).not.toHaveBeenCalled();
  });

  it("saves the desired ACL state (flip private → public)", async () => {
    wrap(<SkillsetPermissionsModal isOpen onClose={() => {}} skillset={PRIVATE_SET} />);

    // Check the Public checkbox (the only checkbox on the Read tab when the
    // caller has no orgs).
    const publicCheckbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(publicCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSkillsetPermissions).toHaveBeenCalledTimes(1));
    // New canonical payload (#1125): public, no grants.
    expect(updateSkillsetPermissions).toHaveBeenCalledWith({ isPrivate: false, grants: [] });
  });

  it("short-circuits with no save when nothing changed", async () => {
    const onClose = vi.fn();
    wrap(<SkillsetPermissionsModal isOpen onClose={onClose} skillset={PRIVATE_SET} />);

    // Save without changing anything (still private, no grants).
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateSkillsetPermissions).not.toHaveBeenCalled();
  });
});
