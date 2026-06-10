/**
 * SkillsetHeroStrip — the skillset detail hero adapter over DetailHeroStrip
 * (#1067).
 *
 * @module components/skillset/SkillsetHeroStrip.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SkillsetHeroStrip } from "./SkillsetHeroStrip";
import type { SkillsetDetail } from "@/types/skillset";

const DETAIL: SkillsetDetail = {
  guid: "g-1",
  name: "research-bundle",
  description: "A curated comparison set",
  instructions: "Run A, then B.",
  kind: "consensus-supported",
  tags: ["research", "rag"],
  members: ["a@1.0", "b@1.0"],
  version: "1.1",
  latestVersion: "1.1",
  isPrivate: true,
  createdBy: "user-1",
  sharedWithUsers: ["u1"],
  sharedWithOrgs: [],
  createdOn: "2026-06-01T00:00:00.000Z",
  updatedOn: "2026-06-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsetHeroStrip", () => {
  it("renders the name, description, kind/visibility/version pills, and tags", () => {
    render(<SkillsetHeroStrip skillset={DETAIL} isOwner={false} />);
    expect(screen.getByRole("heading", { name: "research-bundle" })).toBeInTheDocument();
    expect(screen.getByText("A curated comparison set")).toBeInTheDocument();
    // Pills.
    expect(screen.getByText("Consensus")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("v1.1")).toBeInTheDocument();
    // Tags.
    expect(screen.getByText("#research")).toBeInTheDocument();
    expect(screen.getByText("#rag")).toBeInTheDocument();
  });

  it("renders Public visibility + Bundle kind for a public generic skillset", () => {
    render(
      <SkillsetHeroStrip
        skillset={{ ...DETAIL, kind: "generic", isPrivate: false }}
        isOwner={false}
      />,
    );
    expect(screen.getByText("Bundle")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
  });

  it("shows Edit + Permissions actions for the owner and wires the callbacks", () => {
    const onEdit = vi.fn();
    const onManagePermissions = vi.fn();
    render(
      <SkillsetHeroStrip
        skillset={DETAIL}
        isOwner
        onEdit={onEdit}
        onManagePermissions={onManagePermissions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onManagePermissions).toHaveBeenCalledTimes(1);
  });

  it("hides owner actions for non-owners", () => {
    render(
      <SkillsetHeroStrip
        skillset={DETAIL}
        isOwner={false}
        onEdit={vi.fn()}
        onManagePermissions={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Permissions" })).not.toBeInTheDocument();
  });

  it("renders the supplied version picker slot", () => {
    render(
      <SkillsetHeroStrip
        skillset={DETAIL}
        isOwner={false}
        versionPicker={<div data-testid="version-picker">picker</div>}
      />,
    );
    expect(screen.getByTestId("version-picker")).toBeInTheDocument();
  });
});
