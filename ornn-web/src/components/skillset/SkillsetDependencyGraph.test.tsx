/**
 * SkillsetDependencyGraph — the read-only Mermaid path, the lazy editor mount,
 * and the #1064 / #1067 no-mutation grep-guard (now covering BOTH the graph
 * dispatcher and its react-flow canvas child).
 *
 * The Mermaid renderer is heavy (pulls real `mermaid` into jsdom), so we stub
 * `<MermaidBlock>` to a marker div. The editor branch lazy-loads the real
 * react-flow canvas; its interaction wiring (onConnect / onEdgesDelete /
 * click-to-connect) is asserted in SkillsetDependencyGraphCanvas.test — here we
 * only assert the lazy surface mounts.
 *
 * @module components/skillset/SkillsetDependencyGraph.test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/docs/DocsMermaid", () => ({
  MermaidBlock: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid">{chart}</div>
  ),
}));

import { SkillsetDependencyGraph } from "./SkillsetDependencyGraph";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MEMBERS = ["a@1.0", "b@1.0", "c@1.0"];

describe("SkillsetDependencyGraph — editor mount", () => {
  it("lazy-loads the react-flow canvas when given ≥2 members + a handler", async () => {
    render(
      <SkillsetDependencyGraph members={MEMBERS} edges={[]} onEdgesChange={vi.fn()} />,
    );
    // The canvas is React.lazy — its click-to-connect grid appears after the
    // dynamic import resolves.
    expect(await screen.findByTestId("graph-columns")).toBeInTheDocument();
    expect(await screen.findByTestId("graph-canvas")).toBeInTheDocument();
  });

  it("shows the needs-members hint with fewer than two members", () => {
    render(
      <SkillsetDependencyGraph members={["a@1.0"]} edges={[]} onEdgesChange={vi.fn()} />,
    );
    expect(screen.getByText(/Add at least two members/)).toBeInTheDocument();
    expect(screen.queryByTestId("graph-canvas")).not.toBeInTheDocument();
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

  it("does NOT load react-flow on the read path (no canvas)", () => {
    render(
      <SkillsetDependencyGraph
        readOnly
        members={MEMBERS}
        edges={[{ from: "a@1.0", to: "b@1.0" }]}
      />,
    );
    expect(screen.queryByTestId("graph-canvas")).not.toBeInTheDocument();
  });
});

describe("#1064 contract: no skill-mutation / closure import in the graph path", () => {
  /** Comments are stripped so contract prose doesn't trip the scanner. */
  function strip(raw: string): string {
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

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

  // Both the dispatcher AND its lazy react-flow canvas must be clean (#1067).
  for (const file of [
    "SkillsetDependencyGraph.tsx",
    "SkillsetDependencyGraphCanvas.tsx",
  ]) {
    it(`${file} imports no skill-mutation or closure hook`, () => {
      const src = strip(readFileSync(join(__dirname, file), "utf8"));
      for (const re of FORBIDDEN) {
        expect(re.test(src), `forbidden token ${re} present in ${file}`).toBe(false);
      }
    });
  }
});
