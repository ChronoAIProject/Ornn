/**
 * SkillsetAutoUpdateCard — owner-only "always keep skills up to date" toggle
 * (#1191). The mutation + toast are mocked so the test drives state and asserts
 * the payload / owner gating.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SkillsetDetail } from "@/types/skillset";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/hooks/useSkillsets", () => ({
  useUpdateAutoUpdate: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));

import { SkillsetAutoUpdateCard } from "./SkillsetAutoUpdateCard";

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
  autoUpdateMembers: false,
  publicMemberCount: 2,
  unreadableMembers: [],
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
});

describe("SkillsetAutoUpdateCard", () => {
  it("renders nothing for a non-owner", () => {
    const { container } = render(
      <SkillsetAutoUpdateCard skillset={BASE} isOwner={false} idOrName="research-bundle" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("OFF state: shows the pinned-versions label + a Turn on button", () => {
    render(<SkillsetAutoUpdateCard skillset={BASE} isOwner idOrName="research-bundle" />);
    expect(screen.getByText("Off — using pinned versions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
  });

  it("ON state: shows the tracking-latest label + a Turn off button", () => {
    render(
      <SkillsetAutoUpdateCard
        skillset={{ ...BASE, autoUpdateMembers: true }}
        isOwner
        idOrName="research-bundle"
      />,
    );
    expect(screen.getByText("On — tracking latest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("enabling calls the mutation with { enabled: true }", async () => {
    mutateAsync.mockResolvedValue({});
    render(<SkillsetAutoUpdateCard skillset={BASE} isOwner idOrName="research-bundle" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ enabled: true }));
  });

  it("disabling calls the mutation with { enabled: false }", async () => {
    mutateAsync.mockResolvedValue({});
    render(
      <SkillsetAutoUpdateCard
        skillset={{ ...BASE, autoUpdateMembers: true }}
        isOwner
        idOrName="research-bundle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ enabled: false }));
  });
});
