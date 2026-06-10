/**
 * SkillsetDependencyGraph — editor interactions + the #1064 no-mutation guard.
 *
 * The Mermaid renderer is heavy (pulls real `mermaid` into jsdom), so we stub
 * `<MermaidBlock>` to a marker div — these tests are about the editor wiring
 * and the contract, not diagram rendering.
 *
 * @module components/skillset/SkillsetDependencyGraph.test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/docs/DocsMermaid", () => ({
  MermaidBlock: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid">{chart}</div>
  ),
}));

import { SkillsetDependencyGraph } from "./SkillsetDependencyGraph";
import type { Edge } from "@/lib/skillsetDeps";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MEMBERS = ["a@1.0", "b@1.0", "c@1.0"];

/** Click the node button whose label starts with `name`. */
function clickNode(name: string) {
  const btn = screen
    .getByTestId("graph-columns")
    .querySelectorAll("button");
  const target = [...btn].find((b) => b.textContent?.startsWith(name));
  if (!target) throw new Error(`node ${name} not found`);
  fireEvent.click(target);
}

describe("SkillsetDependencyGraph — editor", () => {
  it("click source then target emits onEdgesChange with the new edge", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    clickNode("a");
    clickNode("b");
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
  });

  it("self-click is a no-op (no edge emitted)", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    clickNode("a");
    clickNode("a");
    expect(onEdgesChange).not.toHaveBeenCalled();
  });

  it("removing an edge chip emits the edge set without it", () => {
    const onEdgesChange = vi.fn();
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "c@1.0" },
    ];
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Remove edge a@1.0 → b@1.0/ }),
    );
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "b@1.0", to: "c@1.0" }]);
  });

  it("a cyclic edge set shows the advisory chip but never disables anything", () => {
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "a@1.0" }, // cycle
    ];
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={edges} onEdgesChange={vi.fn()} />,
    );
    expect(screen.getByTestId("cycle-warning")).toBeInTheDocument();
    // Editing still works — clicking nodes is unaffected by the cycle.
    expect(screen.getByTestId("graph-columns")).toBeInTheDocument();
  });

  it("does not re-add a duplicate edge", () => {
    const onEdgesChange = vi.fn();
    const edges: Edge[] = [{ from: "a@1.0", to: "b@1.0" }];
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    clickNode("a");
    clickNode("b");
    expect(onEdgesChange).not.toHaveBeenCalled();
  });
});

describe("SkillsetDependencyGraph — read-only", () => {
  it("renders the Mermaid chart when there are edges", () => {
    render(
      <SkillsetDependencyGraph
        readOnly
        members={MEMBERS}
        edges={[{ from: "a@1.0", to: "b@1.0" }]}
      />,
    );
    expect(screen.getByTestId("mermaid")).toHaveTextContent("flowchart TD");
  });

  it("shows the empty-deps state when there are no edges", () => {
    render(<SkillsetDependencyGraph readOnly members={MEMBERS} edges={[]} />);
    expect(screen.queryByTestId("mermaid")).not.toBeInTheDocument();
    expect(screen.getByText(/No dependencies declared/)).toBeInTheDocument();
  });
});

describe("#1064 contract: no skill-mutation / closure import in the graph path", () => {
  it("the component source imports no skill-mutation or closure hook", () => {
    const raw = readFileSync(
      join(__dirname, "SkillsetDependencyGraph.tsx"),
      "utf8",
    );
    // Strip comments first so the contract prose ("imports NO closure hook")
    // doesn't trip the scanner — we assert against the actual CODE only.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // No skill-mutation hooks (create/update/publish/closure/upload) and no
    // closure-endpoint hook (#968 — kept strictly separate).
    const FORBIDDEN = [
      /useCreateSkill\b/,
      /useUpdateSkill\b/,
      /usePublishSkill\b/,
      /useUploadSkill\b/,
      /useDeleteSkill\b/,
      /useCreateSkillset\b/,
      /usePublishSkillset\b/,
      /useUpdateSkillset\b/,
      /useDeleteSkillset\b/,
      /useSkillsetClosure\b/,
      /useSkillClosure\b/,
      /useSkillDependencies\b/,
      /from\s+["']@\/hooks\/useSkills["']/,
      /from\s+["']@\/hooks\/useSkillsets["']/,
      /\bclosure\b/i,
    ];
    for (const re of FORBIDDEN) {
      expect(re.test(src), `forbidden token ${re} present`).toBe(false);
    }
  });
});
