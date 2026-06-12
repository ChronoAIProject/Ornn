/**
 * RegistryTabs — the shared registry tab strip lifted out of ExplorePage
 * (#1067).
 *
 * @module components/registry/RegistryTabs.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryTabs, TabButton } from "./RegistryTabs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegistryTabs", () => {
  it("renders one button per tab and marks the active one", () => {
    render(
      <RegistryTabs
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        activeId="b"
        onSelect={vi.fn()}
      />,
    );
    const active = screen.getByRole("button", { name: "Beta" });
    const idle = screen.getByRole("button", { name: "Alpha" });
    expect(active.className).toContain("bg-accent/20");
    expect(idle.className).not.toContain("bg-accent/20");
  });

  it("fires onSelect with the tab id when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(
      <RegistryTabs
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        activeId="a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("renders an optional count badge when provided", () => {
    render(
      <RegistryTabs
        tabs={[{ id: "a", label: "Alpha", count: 12 }]}
        activeId="a"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

describe("TabButton", () => {
  it("omits the count badge when count is undefined", () => {
    render(<TabButton label="Solo" active={false} onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Solo" });
    // Only the label span — no trailing count badge.
    expect(btn.querySelectorAll("span")).toHaveLength(1);
  });

  it("renders the active styling", () => {
    render(<TabButton label="On" count={3} active onClick={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("bg-accent/20");
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
