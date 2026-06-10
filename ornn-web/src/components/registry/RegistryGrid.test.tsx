/**
 * RegistryGrid — the shared loading / empty / items grid body lifted out of
 * ExplorePage (#1067).
 *
 * @module components/registry/RegistryGrid.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RegistryGrid } from "./RegistryGrid";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface Row {
  id: string;
  name: string;
}

function renderGrid(over: Partial<React.ComponentProps<typeof RegistryGrid<Row>>> = {}) {
  return render(
    <RegistryGrid<Row>
      items={[]}
      loading={false}
      getKey={(r) => r.id}
      renderItem={(r) => <div data-testid="row">{r.name}</div>}
      empty={<div data-testid="empty">nothing here</div>}
      page={1}
      totalPages={1}
      onPageChange={vi.fn()}
      {...over}
    />,
  );
}

describe("RegistryGrid", () => {
  it("renders skeleton placeholders while loading (no items, no empty)", () => {
    const { container } = renderGrid({ loading: true, skeletonCount: 4 });
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row")).not.toBeInTheDocument();
    // The skeleton grid renders `skeletonCount` direct children.
    const grid = container.querySelector(".grid");
    expect(grid?.children.length).toBe(4);
  });

  it("renders the empty slot when not loading and there are no items", () => {
    renderGrid({ items: [] });
    expect(screen.getByTestId("empty")).toHaveTextContent("nothing here");
    expect(screen.queryByTestId("row")).not.toBeInTheDocument();
  });

  it("renders one item per row via renderItem", () => {
    renderGrid({
      items: [
        { id: "a", name: "alpha" },
        { id: "b", name: "beta" },
      ],
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
  });
});
