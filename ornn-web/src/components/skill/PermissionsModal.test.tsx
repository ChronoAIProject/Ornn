/**
 * PermissionsModal level tests (#1123).
 *
 * Guards the typed-grant flow: an existing read_write user grant renders the
 * read-write toggle, flipping it to read and saving sends the canonical
 * `grants` payload with the new level.
 *
 * orgs / directory / mutation / toast are mocked; framer-motion is stubbed;
 * react-i18next is global.
 *
 * @module components/skill/PermissionsModal.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillDetail } from "@/types/domain";

const mutateAsync = vi.fn();
const addToast = vi.fn();
const resolveUsers = vi.fn();
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

vi.mock("@/hooks/useMe", () => ({ useMyOrgs: () => ({ data: [] }) }));
vi.mock("@/hooks/useSkills", () => ({
  useUpdateSkillPermissions: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) => selector({ addToast }),
}));
vi.mock("@/services/usersApi", () => ({
  resolveUsers: (...a: unknown[]) => resolveUsers(...a),
  searchUsersByEmail: (...a: unknown[]) => searchUsersByEmail(...a),
  fetchOrgSummary: vi.fn(),
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
    sharedWithUsers: ["u1"],
    sharedWithOrgs: [],
    grants: [{ type: "user", id: "u1", level: "read_write" }],
    ...overrides,
  } as SkillDetail;
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionsModal isOpen onClose={() => {}} skill={skill()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ skill: skill() });
  addToast.mockReset();
  // Resolve u1 to a real label so the chip is not "unresolved" → the level
  // toggle renders.
  resolveUsers.mockReset().mockResolvedValue([
    { userId: "u1", email: "u1@x.io", displayName: "User One" },
  ]);
  searchUsersByEmail.mockReset().mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("PermissionsModal — permission levels (#1123)", () => {
  it("renders the read-write toggle for an existing read_write grant and saves the flipped level as typed grants", async () => {
    renderModal();

    // After the directory resolves u1, its chip shows the read-write toggle.
    const toggle = await screen.findByRole("button", { name: /read-write/i });
    expect(toggle).toBeTruthy();

    // Flip read-write → read.
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: /^read$/i });

    // Save sends the canonical typed grants with the new level.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        isPrivate: true,
        grants: [{ type: "user", id: "u1", level: "read" }],
      }),
    );
  });
});
