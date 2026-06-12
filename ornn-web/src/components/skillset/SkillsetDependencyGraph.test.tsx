/**
 * SkillsetDependencyGraph — the read-only Mermaid path, the lazy editor mount,
 * and the #1064 / #1067 no-mutation grep-guard (now covering BOTH the graph
 * dispatcher and its react-flow canvas child).
 *
 * The read-only path now uses the canvas (proper engine). We stub the canvas
 * (and kept old mermaid mock for compatibility). Editor wiring tested in the
 * canvas-specific test file. Here we assert dispatcher + read-only canvas mount.
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

// Canvas used for both editor and (now) read-only detail. Provide the testids
// that editor lazy test and read-only expect.
vi.mock("@/components/skillset/SkillsetDependencyGraphCanvas", () => ({
  SkillsetDependencyGraphCanvas: ({ members }: { members?: string[] }) => (
    <div data-testid="graph-columns">
      <div data-testid="graph-canvas">{(members || []).join(",")}</div>
    </div>
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
  it("renders the canvas graph when there are edges", () => {
    render(
      <SkillsetDependencyGraph
        readOnly
        members={MEMBERS}
        edges={[{ from: "a@1.0", to: "b@1.0" }]}
      />,
    );
    expect(screen.getByTestId("graph-canvas")).toHaveTextContent("a@1.0,b@1.0,c@1.0");
  });

  it("shows the empty-deps state when there are no edges", () => {
    render(<SkillsetDependencyGraph readOnly members={MEMBERS} edges={[]} />);
    expect(screen.queryByTestId("graph-canvas")).not.toBeInTheDocument();
    expect(screen.getByText(/No dependencies declared/)).toBeInTheDocument();
  });

  it("read-only now uses the canvas (proper engine for hover/space)", () => {
    render(
      <SkillsetDependencyGraph
        readOnly
        members={MEMBERS}
        edges={[{ from: "a@1.0", to: "b@1.0" }]}
      />,
    );
    // Previously avoided canvas on read path; now intentionally uses it for
    // better rendering per request.
    expect(screen.getByTestId("graph-canvas")).toBeInTheDocument();
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
