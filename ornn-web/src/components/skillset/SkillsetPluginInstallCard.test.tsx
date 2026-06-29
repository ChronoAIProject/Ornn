/**
 * SkillsetPluginInstallCard — gating + command rendering (#1155).
 *
 * The card must render ONLY when the skillset is actually exported to the
 * mirror (opt-in + all-public) AND the mirror is enabled (a repo to install
 * from). The repo coords come from the public github/repo endpoint via
 * useGithubRepo — mocked here so the test controls enabled/owner/repo.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SkillsetPluginInstallCard } from "./SkillsetPluginInstallCard";

const { repoState } = vi.hoisted(() => ({
  repoState: {
    data: undefined as
      | undefined
      | { owner: string; repo: string; branch: string; enabled: boolean },
  },
}));

vi.mock("@/hooks/useGithubMirror", () => ({
  useGithubRepo: () => repoState,
}));

const ENABLED = { owner: "ChronoAIProject", repo: "ornn-skills", branch: "main", enabled: true };

afterEach(() => {
  cleanup();
  repoState.data = undefined;
});

describe("SkillsetPluginInstallCard", () => {
  it("renders nothing when the skillset is not opted in", () => {
    repoState.data = ENABLED;
    const { container } = render(
      <SkillsetPluginInstallCard
        skillsetName="research-bundle"
        exportAsPlugin={false}
        memberVisibilityState="all-public"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when members are not all public", () => {
    repoState.data = ENABLED;
    const { container } = render(
      <SkillsetPluginInstallCard
        skillsetName="research-bundle"
        exportAsPlugin={true}
        memberVisibilityState="restricted"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the mirror is disabled", () => {
    repoState.data = { ...ENABLED, enabled: false };
    const { container } = render(
      <SkillsetPluginInstallCard
        skillsetName="research-bundle"
        exportAsPlugin={true}
        memberVisibilityState="all-public"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the marketplace-add + install commands for an exported skillset", () => {
    repoState.data = ENABLED;
    const { container } = render(
      <SkillsetPluginInstallCard
        skillsetName="research-bundle"
        exportAsPlugin={true}
        memberVisibilityState="all-public"
      />,
    );
    expect(container.textContent).toContain(
      "/plugin marketplace add ChronoAIProject/ornn-skills",
    );
    expect(container.textContent).toContain("/plugin install research-bundle@ornn-skills");
  });
});
