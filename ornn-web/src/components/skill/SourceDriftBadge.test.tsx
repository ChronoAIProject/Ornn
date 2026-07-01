/**
 * SourceDriftBadge tests (#1178) — each driftState renders the right copy +
 * DESIGN.md state-token tone, and nothing renders for the no-drift / non-github
 * cases so legacy skills look unchanged. react-i18next is globally mocked and
 * resolves keys from en.json (with {{when}} interpolation).
 *
 * @module components/skill/SourceDriftBadge.test
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SourceDriftBadge } from "./SourceDriftBadge";
import type { SkillSource } from "@/types/domain";

afterEach(cleanup);

function gh(
  driftState?: SkillSource["driftState"],
  extra: Partial<Extract<SkillSource, { type: "github" }>> = {},
): SkillSource {
  return {
    type: "github",
    repo: "o/r",
    ref: "main",
    path: "",
    ...(driftState ? { driftState } : {}),
    ...extra,
  };
}

describe("SourceDriftBadge", () => {
  it("renders nothing before the first drift check (no driftState)", () => {
    const { container } = render(<SourceDriftBadge source={gh()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an undefined source", () => {
    const { container } = render(<SourceDriftBadge source={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("in_sync → 'Auto-synced' with success tone", () => {
    render(<SourceDriftBadge source={gh("in_sync", { lastSyncedAt: new Date().toISOString() })} />);
    const el = screen.getByText(/Auto-synced/);
    expect(el.className).toContain("text-success");
  });

  it("drifted → 'Update in progress' with info tone", () => {
    render(<SourceDriftBadge source={gh("drifted")} />);
    const el = screen.getByText("Update in progress");
    expect(el.className).toContain("text-info");
  });

  it("changed_unversioned → warning tone + explanatory copy", () => {
    render(<SourceDriftBadge source={gh("changed_unversioned")} />);
    const el = screen.getByText(/version not bumped/i);
    expect(el.className).toContain("text-warning");
    expect(el.getAttribute("title")).toMatch(/bump the version/i);
  });

  it("broken → danger tone", () => {
    render(<SourceDriftBadge source={gh("broken")} />);
    const el = screen.getByText("Source unavailable");
    expect(el.className).toContain("text-danger");
  });
});
