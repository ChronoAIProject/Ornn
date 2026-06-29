/**
 * SkillsetVisibilityBadge — derived visibility badge (#1136).
 *
 * @module components/skillset/SkillsetVisibilityBadge.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillsetVisibilityBadge } from "./SkillsetVisibilityBadge";

afterEach(() => cleanup());

describe("SkillsetVisibilityBadge", () => {
  it("renders 'Public' for all-public", () => {
    render(<SkillsetVisibilityBadge state="all-public" />);
    expect(screen.getByText("Public")).toBeInTheDocument();
  });

  it("renders 'Restricted' for restricted", () => {
    render(<SkillsetVisibilityBadge state="restricted" />);
    expect(screen.getByText("Restricted")).toBeInTheDocument();
  });

  it("renders 'Broken' for unresolvable", () => {
    render(<SkillsetVisibilityBadge state="unresolvable" />);
    expect(screen.getByText("Broken")).toBeInTheDocument();
  });
});
