/**
 * SkillsetMemberWarningBanner — owner-only member-access warning (#1136).
 *
 * @module components/skillset/SkillsetMemberWarningBanner.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillsetMemberWarningBanner } from "./SkillsetMemberWarningBanner";

afterEach(() => cleanup());

describe("SkillsetMemberWarningBanner", () => {
  it("renders nothing when there are no unreadable members", () => {
    const { container } = render(
      <SkillsetMemberWarningBanner unreadableMembers={[]} unresolvable={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the access-lost title + the affected refs (warning tone)", () => {
    render(
      <SkillsetMemberWarningBanner
        unreadableMembers={["secret@1.0", "private-tool@2.1"]}
        unresolvable={false}
      />,
    );
    expect(
      screen.getByText("You no longer have access to some member skills"),
    ).toBeInTheDocument();
    expect(screen.getByText("secret@1.0")).toBeInTheDocument();
    expect(screen.getByText("private-tool@2.1")).toBeInTheDocument();
  });

  it("shows the broken title when the members are unresolvable", () => {
    render(
      <SkillsetMemberWarningBanner unreadableMembers={["gone@1.0"]} unresolvable />,
    );
    expect(screen.getByText("Some member skills no longer exist")).toBeInTheDocument();
    expect(screen.getByText("gone@1.0")).toBeInTheDocument();
  });
});
