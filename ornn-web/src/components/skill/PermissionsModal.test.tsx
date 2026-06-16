/**
 * PermissionsModal tests (#1125) — the two-tab Read / Write editor.
 *
 * Headline guard: an owner can set "public read + org write" (the combination
 * the old single-ladder modal could not express), and Save emits the correct
 * typed `grants` + `isPrivate`.
 *
 * orgs / directory / mutation / toast are mocked; framer-motion is stubbed;
 * react-i18next is global.
 *
 * @module components/skill/PermissionsModal.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillDetail } from "@/types/domain";

const mutateAsync = vi.fn();
const addToast = vi.fn();
const resolveUsers = vi.fn();

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

vi.mock("@/hooks/useMe", () => ({ useMyOrgs: () => ({ data: [{ userId: "org-1", displayName: "Org One" }] }) }));
vi.mock("@/hooks/useSkills", () => ({
  useUpdateSkillPermissions: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) => selector({ addToast }),
}));
vi.mock("@/services/usersApi", () => ({
  resolveUsers: (...a: unknown[]) => resolveUsers(...a),
  searchUsersByEmail: vi.fn().mockResolvedValue([]),
  fetchOrgSummary: vi.fn().mockResolvedValue(null),
}));

import { PermissionsModal } from "./PermissionsModal";

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
    grants: [],
    ...overrides,
  } as SkillDetail;
}

function renderModal(s: SkillDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionsModal isOpen onClose={() => {}} skill={s} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ skill: skill() });
  addToast.mockReset();
  resolveUsers.mockReset().mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("PermissionsModal — two-tab Read/Write editor (#1125)", () => {
  it("lets an owner set public read + org write and saves the right grants", async () => {
    renderModal(skill());

    // Read tab is default → turn on Public.
    fireEvent.click(screen.getByRole("checkbox", { name: /public/i }));

    // Switch to the Write tab and grant the org write access.
    fireEvent.click(screen.getByRole("button", { name: /write access/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Org One" }));

    // Save → public (isPrivate:false) + a read_write org grant; no read grant
    // (public makes read grants redundant, so they're dropped).
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mutateAsync).toHaveBeenCalledWith({
      isPrivate: false,
      grants: [{ type: "org", id: "org-1", level: "read_write" }],
    });
  });

  it("seeds the Write tab from an existing read_write grant", () => {
    renderModal(skill({ grants: [{ type: "org", id: "org-1", level: "read_write" }] }));
    // The Write tab shows a count badge of 1.
    const writeTab = screen.getByRole("button", { name: /write access/i });
    expect(writeTab.textContent).toContain("1");
  });

  it("short-circuits with no changes when nothing is edited", () => {
    renderModal(skill({ isPrivate: false, grants: [] }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });
});
