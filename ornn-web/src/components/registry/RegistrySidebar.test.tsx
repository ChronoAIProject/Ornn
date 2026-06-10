/**
 * RegistrySidebar primitives — the shared filter chip/section building blocks
 * lifted out of ExplorePage (#1067).
 *
 * @module components/registry/RegistrySidebar.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  FilterSection,
  FilterEmpty,
  FilterChipList,
  FilterChip,
} from "./RegistrySidebar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegistrySidebar primitives", () => {
  it("FilterChip renders its label and fires onClick", () => {
    const onClick = vi.fn();
    render(<FilterChip label="research" selected={false} onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /research/ });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("FilterChip renders an optional count badge", () => {
    render(<FilterChip label="rag" count={7} selected={false} onClick={vi.fn()} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("FilterChip omits the count badge when count is undefined", () => {
    const { container } = render(
      <FilterChip label="solo" selected={false} onClick={vi.fn()} />,
    );
    // Only the label span — no trailing mono count badge.
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });

  it("FilterChip reflects the selected styling via the accent treatment", () => {
    const { rerender } = render(
      <FilterChip label="x" selected={false} onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button").className).not.toContain("bg-accent/15");
    rerender(<FilterChip label="x" selected onClick={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("bg-accent/15");
  });

  it("FilterSection renders the uppercase title and its children", () => {
    render(
      <FilterSection title="Tag">
        <FilterChipList>
          <FilterEmpty>No tags yet.</FilterEmpty>
        </FilterChipList>
      </FilterSection>,
    );
    expect(screen.getByRole("heading", { name: "Tag" })).toBeInTheDocument();
    expect(screen.getByText("No tags yet.")).toBeInTheDocument();
  });
});
