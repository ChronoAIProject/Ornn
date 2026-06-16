/**
 * SkillsetDerivedVisibilityCard — read-only derived visibility card (#1136).
 *
 * @module components/skillset/SkillsetDerivedVisibilityCard.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillsetDerivedVisibilityCard } from "./SkillsetDerivedVisibilityCard";

afterEach(() => cleanup());

describe("SkillsetDerivedVisibilityCard", () => {
  it("renders the all-public badge + explanation, with no manage control", () => {
    render(
      <SkillsetDerivedVisibilityCard state="all-public" unreadableCount={0} isOwner />,
    );
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText(/Every member skill is public/)).toBeInTheDocument();
    // Read-only: there is no "Manage permissions" action.
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("explains the restricted state", () => {
    render(
      <SkillsetDerivedVisibilityCard state="restricted" unreadableCount={0} isOwner={false} />,
    );
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText(/only people who can read every member/)).toBeInTheDocument();
  });

  it("shows the owner unreadable hint only for the owner when members are lost", () => {
    const { rerender } = render(
      <SkillsetDerivedVisibilityCard state="restricted" unreadableCount={2} isOwner />,
    );
    expect(screen.getByText(/no longer readable by you/)).toBeInTheDocument();

    // Non-owner never sees the hint (they wouldn't have unreadable members anyway).
    rerender(
      <SkillsetDerivedVisibilityCard state="restricted" unreadableCount={2} isOwner={false} />,
    );
    expect(screen.queryByText(/no longer readable by you/)).not.toBeInTheDocument();
  });

  it("explains the unresolvable (broken) state", () => {
    render(
      <SkillsetDerivedVisibilityCard state="unresolvable" unreadableCount={1} isOwner />,
    );
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });
});
