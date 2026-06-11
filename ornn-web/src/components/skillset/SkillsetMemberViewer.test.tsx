/**
 * SkillsetMemberViewer — member selector + read-only package preview (#1080).
 *
 * Mocks the data hooks (`useSkill` → SkillDetail, `useSkillPackage` → files)
 * and the heavy `SkillPackagePreview`, asserting the wiring: a tab per member,
 * the first member previewed by default, click-to-switch, and the
 * access/empty states.
 *
 * @module components/skillset/SkillsetMemberViewer.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const useSkill = vi.fn();
const useSkillPackage = vi.fn();

vi.mock("@/hooks/useSkills", () => ({ useSkill: (...a: unknown[]) => useSkill(...a) }));
vi.mock("@/hooks/useSkillPackage", () => ({
  useSkillPackage: (...a: unknown[]) => useSkillPackage(...a),
}));
vi.mock("@/components/skill/SkillPackagePreview", () => ({
  SkillPackagePreview: ({ files }: { files: { name: string }[] }) => (
    <div data-testid="package-preview">{files.map((f) => f.name).join(",")}</div>
  ),
}));

import { SkillsetMemberViewer } from "./SkillsetMemberViewer";

const MEMBERS = ["alpha@1.0", "beta@2.1"];

beforeEach(() => {
  useSkill.mockReturnValue({
    data: { presignedPackageUrl: "https://signed/pkg.zip" },
    isLoading: false,
    error: null,
  });
  useSkillPackage.mockReturnValue({
    files: [{ id: "f1", name: "SKILL.md" }],
    fileContents: new Map(),
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsetMemberViewer", () => {
  it("renders a tab per member and previews the first member by default", () => {
    render(
      <MemoryRouter>
        <SkillsetMemberViewer members={MEMBERS} />
      </MemoryRouter>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(useSkill).toHaveBeenCalledWith("alpha", "1.0");
    expect(screen.getByTestId("package-preview")).toHaveTextContent("SKILL.md");
  });

  it("switches the previewed member when another tab is clicked", () => {
    render(
      <MemoryRouter>
        <SkillsetMemberViewer members={MEMBERS} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("beta"));
    expect(useSkill).toHaveBeenLastCalledWith("beta", "2.1");
  });

  it("shows an access message when the member skill is unavailable", () => {
    useSkill.mockReturnValue({ data: undefined, isLoading: false, error: new Error("403") });
    render(
      <MemoryRouter>
        <SkillsetMemberViewer members={MEMBERS} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/isn't available to you/i)).toBeInTheDocument();
    expect(screen.queryByTestId("package-preview")).not.toBeInTheDocument();
  });

  it("shows the empty state for a skillset with no members", () => {
    render(
      <MemoryRouter>
        <SkillsetMemberViewer members={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no members/i)).toBeInTheDocument();
  });
});
