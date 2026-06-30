/**
 * SkillsetPluginExportCard — owner gating, install snippet, and confirm modal
 * payload (#1157).
 *
 * The card is the single home for plugin export: owner-only action (button +
 * modal + stop), install snippet visible to any viewer once exported. The repo
 * coords come from the public github/repo endpoint via useGithubRepo, and the
 * mutation via useUpdatePluginExport — both mocked so the test drives state.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SkillsetDetail } from "@/types/skillset";

const { repoState, mutateAsync } = vi.hoisted(() => ({
  repoState: {
    data: undefined as
      | undefined
      | { owner: string; repo: string; branch: string; enabled: boolean },
  },
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useGithubMirror", () => ({
  useGithubRepo: () => repoState,
}));

vi.mock("@/hooks/useSkillsets", () => ({
  useUpdatePluginExport: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));

import { SkillsetPluginExportCard } from "./SkillsetPluginExportCard";

const ENABLED = { owner: "ChronoAIProject", repo: "ornn-skills", branch: "main", enabled: true };

const BASE: SkillsetDetail = {
  guid: "g-1",
  name: "research-bundle",
  description: "A curated set",
  instructions: "Run A, then B.",
  kind: "generic",
  tags: ["research"],
  members: ["a@1.0", "b@1.0"],
  version: "1.0",
  latestVersion: "1.0",
  isPrivate: false,
  createdBy: "user-1",
  sharedWithUsers: [],
  sharedWithOrgs: [],
  memberVisibilityState: "all-public",
  exportAsPlugin: false,
  unreadableMembers: [],
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  repoState.data = undefined;
  mutateAsync.mockReset();
});

describe("SkillsetPluginExportCard", () => {
  it("owner + not exported + all-public: shows an enabled export button", () => {
    repoState.data = ENABLED;
    render(<SkillsetPluginExportCard skillset={BASE} isOwner idOrName="research-bundle" />);
    const btn = screen.getByRole("button", { name: "Export as a Claude Code plugin" });
    expect(btn).not.toBeDisabled();
  });

  it("owner + not exported + restricted: disables the button with a hint", () => {
    repoState.data = ENABLED;
    render(
      <SkillsetPluginExportCard
        skillset={{ ...BASE, memberVisibilityState: "restricted" }}
        isOwner
        idOrName="research-bundle"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Export as a Claude Code plugin" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Only available once every member skill is public."),
    ).toBeInTheDocument();
  });

  it("owner + exported: shows the install snippet + Stop exporting", () => {
    repoState.data = ENABLED;
    render(
      <SkillsetPluginExportCard
        skillset={{ ...BASE, exportAsPlugin: true }}
        isOwner
        idOrName="research-bundle"
      />,
    );
    expect(screen.getByText(/\/plugin install research-bundle@ornn-skills/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop exporting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit fields" })).toBeInTheDocument();
  });

  it("non-owner + exported: shows ONLY the install snippet (no owner actions)", () => {
    repoState.data = ENABLED;
    render(
      <SkillsetPluginExportCard
        skillset={{ ...BASE, exportAsPlugin: true }}
        isOwner={false}
        idOrName="research-bundle"
      />,
    );
    expect(
      screen.getByText(/\/plugin install research-bundle@ornn-skills/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop exporting" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export as a Claude Code plugin" }),
    ).not.toBeInTheDocument();
  });

  it("non-owner + not exported: renders nothing", () => {
    repoState.data = ENABLED;
    const { container } = render(
      <SkillsetPluginExportCard skillset={BASE} isOwner={false} idOrName="research-bundle" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("confirm modal submits the prefilled+edited override payload", async () => {
    repoState.data = ENABLED;
    mutateAsync.mockResolvedValue({ ...BASE, exportAsPlugin: true });
    render(<SkillsetPluginExportCard skillset={BASE} isOwner idOrName="research-bundle" />);

    // Open the modal — fields prefill from the skillset.
    fireEvent.click(screen.getByRole("button", { name: "Export as a Claude Code plugin" }));
    const nameField = screen.getByDisplayValue("research-bundle");
    fireEvent.change(nameField, { target: { value: "Research Bundle" } });

    // Confirm (the modal's "Export" button — distinct from the card trigger).
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      enabled: true,
      displayName: "Research Bundle",
      description: "A curated set",
      keywords: ["research"],
    });
  });

  it("Stop exporting confirms then sends { enabled: false }", async () => {
    repoState.data = ENABLED;
    mutateAsync.mockResolvedValue({ ...BASE, exportAsPlugin: false });
    render(
      <SkillsetPluginExportCard
        skillset={{ ...BASE, exportAsPlugin: true }}
        isOwner
        idOrName="research-bundle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop exporting" }));
    // ConfirmDialog renders a second "Stop exporting" (its confirm button).
    const confirmButtons = screen.getAllByRole("button", { name: "Stop exporting" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ enabled: false });
  });
});
