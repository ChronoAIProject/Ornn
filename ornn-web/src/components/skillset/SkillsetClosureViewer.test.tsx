/**
 * SkillsetClosureViewer — flat render + depth indent.
 *
 * The server pre-flattens the graph; this component just renders the list and
 * indents by `depth`. We assert: every node renders in the given (deps-first)
 * order, depth-0 rows are tagged "member" and deeper rows "dep", and the
 * indent (marginLeft) scales with depth.
 *
 * @module components/skillset/SkillsetClosureViewer.test
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SkillsetClosureViewer } from "./SkillsetClosureViewer";
import type { SkillsetClosureItem } from "@/types/skillset";

const ITEMS: SkillsetClosureItem[] = [
  { ref: "a@1.0", name: "a", version: "1.0", depth: 0 },
  { ref: "b@1.0", name: "b", version: "1.0", depth: 0 },
  { ref: "a-dep@2.1", name: "a-dep", version: "2.1", depth: 1 },
  { ref: "deep@0.3", name: "deep", version: "0.3", depth: 2 },
];

afterEach(() => cleanup());

describe("SkillsetClosureViewer", () => {
  it("renders an empty hint when there are no items", () => {
    render(<SkillsetClosureViewer items={[]} />);
    expect(screen.getByText(/No resolved members/i)).toBeInTheDocument();
  });

  it("renders every node flat, in the given deps-first order", () => {
    render(<SkillsetClosureViewer items={ITEMS} />);
    const rows = within(screen.getByTestId("closure-list")).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("a");
    expect(rows[1]).toHaveTextContent("b");
    expect(rows[2]).toHaveTextContent("a-dep");
    expect(rows[3]).toHaveTextContent("deep");
  });

  it("tags depth-0 rows as members and deeper rows as deps", () => {
    render(<SkillsetClosureViewer items={ITEMS} />);
    const rows = within(screen.getByTestId("closure-list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("member");
    expect(rows[2]).toHaveTextContent("dep");
    expect(rows[3]).toHaveTextContent("dep");
  });

  it("indents each row proportional to its depth", () => {
    render(<SkillsetClosureViewer items={ITEMS} />);
    const rows = within(screen.getByTestId("closure-list")).getAllByRole("listitem");
    // depth 0 → 0px, depth 1 → 20px, depth 2 → 40px.
    expect((rows[0] as HTMLElement).style.marginLeft).toBe("0px");
    expect((rows[2] as HTMLElement).style.marginLeft).toBe("20px");
    expect((rows[3] as HTMLElement).style.marginLeft).toBe("40px");
    // Depth is also reflected on a data attribute for downstream styling.
    expect(rows[2]?.getAttribute("data-depth")).toBe("1");
  });
});
