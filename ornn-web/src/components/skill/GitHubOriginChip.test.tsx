/**
 * GitHubOriginChip tests (#1178) — the auto-sync badge shows next to the
 * "Synced from GitHub" label, and the manual "Refresh from GitHub" override
 * button remains available alongside it.
 *
 * @module components/skill/GitHubOriginChip.test
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GitHubOriginChip } from "./GitHubOriginChip";
import type { SkillSource } from "@/types/domain";

afterEach(cleanup);

function gh(driftState?: SkillSource["driftState"]): SkillSource {
  return {
    type: "github",
    repo: "o/r",
    ref: "main",
    path: "",
    lastSyncedCommit: "abcdef1234567",
    ...(driftState ? { driftState } : {}),
  };
}

describe("GitHubOriginChip", () => {
  it("renders the drift badge AND keeps the manual refresh button", () => {
    render(
      <GitHubOriginChip
        source={gh("changed_unversioned")}
        canRefresh
        isRefreshing={false}
        onRefresh={() => {}}
      />,
    );
    // Passive badge from driftState…
    expect(screen.getByText(/version not bumped/i)).toBeInTheDocument();
    // …and the manual override is still there.
    expect(screen.getByText("Refresh from GitHub")).toBeInTheDocument();
  });

  it("broken source shows the danger badge", () => {
    render(
      <GitHubOriginChip source={gh("broken")} canRefresh isRefreshing={false} onRefresh={() => {}} />,
    );
    expect(screen.getByText("Source unavailable")).toBeInTheDocument();
  });

  it("no badge before the first drift check, but the chip still renders", () => {
    render(
      <GitHubOriginChip source={gh()} canRefresh isRefreshing={false} onRefresh={() => {}} />,
    );
    expect(screen.getByText("Synced from GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Source unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto-synced/)).not.toBeInTheDocument();
  });

  it("fires onRefresh when the manual button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <GitHubOriginChip source={gh("in_sync")} canRefresh isRefreshing={false} onRefresh={onRefresh} />,
    );
    screen.getByText("Refresh from GitHub").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
