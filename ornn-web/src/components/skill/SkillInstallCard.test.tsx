/**
 * SkillInstallCard tests — the "via plugin (Claude Code Marketplace)" tab (#1167).
 *
 * The plugin tab shares the npx tab's gating: a public skill is mirrored as a
 * single-skill plugin, so the marketplace entry only exists when the skill is
 * public AND the mirror is enabled. The three cases below pin that contract:
 *
 *   - public + mirror on  → the two `/plugin …` commands render with the
 *                           configured owner/repo + the skill's canonical name.
 *   - private             → the "available once public" hint, no command.
 *   - mirror off          → the same mirror-not-configured treatment the npx
 *                           tab already uses.
 *
 * `useGithubRepo` is mocked at its seam (`@/hooks/useGithubMirror`) so the test
 * never touches the apiClient / TanStack Query runtime. react-i18next is stubbed
 * globally in src/test/setup.ts (keys resolve against en.json).
 *
 * @module components/skill/SkillInstallCard.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SkillDetail } from "@/types/domain";

const { mockUseGithubRepo } = vi.hoisted(() => ({
  mockUseGithubRepo: vi.fn(),
}));

vi.mock("@/hooks/useGithubMirror", () => ({
  useGithubRepo: () => mockUseGithubRepo(),
}));

import { SkillInstallCard } from "./SkillInstallCard";

function makeSkill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    guid: "skill-guid-1",
    name: "pdf-tools",
    description: "Work with PDFs.",
    createdBy: "user-1",
    createdOn: "2026-06-01T00:00:00.000Z",
    isPrivate: false,
    tags: ["pdf"],
    updatedOn: "2026-06-01T00:00:00.000Z",
    presignedPackageUrl: "https://example.com/pkg.zip",
    metadata: {},
    version: "1.0.0",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    ...overrides,
  };
}

const ENABLED_REPO = {
  data: { owner: "acme", repo: "skills-mirror", branch: "main", enabled: true },
};

function openPluginTab() {
  fireEvent.click(screen.getByRole("tab", { name: /via plugin/i }));
}

beforeEach(() => {
  mockUseGithubRepo.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SkillInstallCard — plugin tab", () => {
  it("renders both /plugin commands for a public skill when the mirror is enabled", () => {
    mockUseGithubRepo.mockReturnValue(ENABLED_REPO);

    const { container } = render(<SkillInstallCard skill={makeSkill()} />);
    openPluginTab();

    const code = container.querySelector("code");
    expect(code?.textContent).toContain("/plugin marketplace add acme/skills-mirror");
    expect(code?.textContent).toContain("/plugin install pdf-tools@skills-mirror");

    // The auto-update reminder is folded into the helper above the box
    // (no per-tab footer) so the panel matches the "via npx" layout.
    expect(screen.getByText(/auto-update off/i)).toBeInTheDocument();
  });

  it("shows the 'available once public' hint for a private skill, no command", () => {
    mockUseGithubRepo.mockReturnValue(ENABLED_REPO);

    const { container } = render(<SkillInstallCard skill={makeSkill({ isPrivate: true })} />);
    openPluginTab();

    expect(screen.getByText(/available once this skill is public/i)).toBeInTheDocument();
    // No command block is rendered for a private skill.
    expect(container.querySelector("code")).toBeNull();
  });

  it("shows the mirror-not-configured treatment when the mirror is disabled", () => {
    mockUseGithubRepo.mockReturnValue({
      data: { owner: "acme", repo: "skills-mirror", branch: "main", enabled: false },
    });

    const { container } = render(<SkillInstallCard skill={makeSkill()} />);
    openPluginTab();

    expect(
      screen.getByText(/doesn't have the github mirror configured/i),
    ).toBeInTheDocument();
    expect(container.querySelector("code")).toBeNull();
  });

  it("shows the mirror-off treatment when no repo config has loaded yet", () => {
    mockUseGithubRepo.mockReturnValue({ data: undefined });

    const { container } = render(<SkillInstallCard skill={makeSkill()} />);
    openPluginTab();

    expect(
      screen.getByText(/doesn't have the github mirror configured/i),
    ).toBeInTheDocument();
    expect(container.querySelector("code")).toBeNull();
  });
});
