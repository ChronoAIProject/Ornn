/**
 * SkillsetDependencyGraphCanvas — the react-flow editor surface (#1067).
 *
 * `@xyflow/react` is mocked to a thin harness that surfaces the `onConnect` /
 * `onEdgesDelete` callbacks as test buttons so we can assert the canvas wiring
 * without react-flow's measured-layout / drag internals (which don't run in
 * jsdom). The click-to-connect node grid, edge chips, and cycle advisory are
 * real DOM and are exercised directly.
 *
 * Also asserts the #1064 contract: the canvas source imports no skill-mutation
 * or closure hook.
 *
 * @module components/skillset/SkillsetDependencyGraphCanvas.test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mock react-flow: render nothing of its own chrome, but expose the wiring
// callbacks via test buttons so we can drive onConnect / onEdgesDelete.
vi.mock("@xyflow/react", () => {
  const ReactFlow = (props: {
    onConnect?: (c: { source: string; target: string }) => void;
    onEdgesDelete?: (e: { source: string; target: string }[]) => void;
  }) => (
    <div data-testid="react-flow">
      <button
        type="button"
        data-testid="rf-connect-a-b"
        onClick={() => props.onConnect?.({ source: "a@1.0", target: "b@1.0" })}
      >
        connect a→b
      </button>
      <button
        type="button"
        data-testid="rf-connect-self"
        onClick={() => props.onConnect?.({ source: "a@1.0", target: "a@1.0" })}
      >
        connect a→a
      </button>
      <button
        type="button"
        data-testid="rf-delete-a-b"
        onClick={() => props.onEdgesDelete?.([{ source: "a@1.0", target: "b@1.0" }])}
      >
        delete a→b
      </button>
    </div>
  );
  return {
    ReactFlow,
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    ConnectionLineType: { SmoothStep: "smoothstep", Bezier: "default" },
    ConnectionMode: { Loose: "loose", Strict: "strict" },
    // Faithful [state, setState, onChange] 3-tuple — destructuring it in the
    // component must not throw. State is the initial nodes; setState/onChange
    // are inert no-ops (jsdom can't measure layout, so positions are untested).
    useNodesState: (init: unknown) => [init ?? [], vi.fn(), vi.fn()],
  };
});

import { SkillsetDependencyGraphCanvas } from "./SkillsetDependencyGraphCanvas";
import type { Edge } from "@/lib/skillsetDeps";

const MEMBERS = ["a@1.0", "b@1.0", "c@1.0"];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Click the click-to-connect node whose label starts with `name`. */
function clickNode(name: string) {
  const buttons = screen.getByTestId("graph-columns").querySelectorAll("button");
  const target = [...buttons].find((b) => b.textContent?.startsWith(name));
  if (!target) throw new Error(`node ${name} not found`);
  fireEvent.click(target);
}

describe("SkillsetDependencyGraphCanvas — react-flow wiring", () => {
  it("the canvas wrapper carries the Forge-palette scope class (#1067)", () => {
    // The scoped class is what re-points react-flow's `--xy-*` vars at the
    // Forge tokens so nodes/edges/handles/selection don't render stock blue.
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={vi.fn()} />,
    );
    expect(screen.getByTestId("graph-canvas")).toHaveClass("skillset-depgraph-canvas");
  });

  it("onConnect emits the new edge via onEdgesChange", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByTestId("rf-connect-a-b"));
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
  });

  it("onConnect self-loop is a no-op", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByTestId("rf-connect-self"));
    expect(onEdgesChange).not.toHaveBeenCalled();
  });

  it("onConnect does not re-add a duplicate edge", () => {
    const onEdgesChange = vi.fn();
    const edges: Edge[] = [{ from: "a@1.0", to: "b@1.0" }];
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByTestId("rf-connect-a-b"));
    expect(onEdgesChange).not.toHaveBeenCalled();
  });

  it("onEdgesDelete removes the edge via onEdgesChange", () => {
    const onEdgesChange = vi.fn();
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "c@1.0" },
    ];
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByTestId("rf-delete-a-b"));
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "b@1.0", to: "c@1.0" }]);
  });
});

describe("SkillsetDependencyGraphCanvas — smoothness pass (#1071)", () => {
  it("a node connection emits ONLY {from,to} — node positions never leak upward", () => {
    // Positions live in session-local useNodesState and are presentation-only;
    // the sole upward emit is onEdgesChange(Edge[]). An exact-shape assertion
    // guards that no x/y ever rides along to the backend.
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByTestId("rf-connect-a-b"));
    const emitted = onEdgesChange.mock.calls[0]?.[0] as Edge[];
    expect(emitted).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
    for (const e of emitted) {
      expect(Object.keys(e).sort()).toEqual(["from", "to"]);
    }
  });

  it("Tidy re-layouts node positions WITHOUT touching edges (no upward emit)", () => {
    // Tidy is the only path that repositions existing nodes; positions are
    // local, so it must never call onEdgesChange.
    const onEdgesChange = vi.fn();
    const edges: Edge[] = [{ from: "a@1.0", to: "b@1.0" }];
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    const tidy = screen.getByTestId("graph-tidy");
    expect(tidy).toBeInTheDocument();
    fireEvent.click(tidy);
    expect(onEdgesChange).not.toHaveBeenCalled();
  });

  it("the canvas reserves a generous editing height (#1071)", () => {
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={vi.fn()} />,
    );
    expect(screen.getByTestId("graph-canvas")).toHaveClass("h-[460px]");
  });
});

describe("SkillsetDependencyGraphCanvas — click-to-connect mirror", () => {
  it("click source then target emits onEdgesChange with the new edge", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
    );
    clickNode("a");
    clickNode("b");
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
  });

  it("self-click is a no-op (no edge emitted)", () => {
    const onEdgesChange = vi.fn();
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={[]} onEdgesChange={onEdgesChange} />,
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
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={edges} onEdgesChange={onEdgesChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove edge a@1.0 → b@1.0/ }));
    expect(onEdgesChange).toHaveBeenCalledTimes(1);
    expect(onEdgesChange.mock.calls[0]?.[0]).toEqual([{ from: "b@1.0", to: "c@1.0" }]);
  });
});

describe("SkillsetDependencyGraphCanvas — cycle advisory", () => {
  it("a cyclic edge set shows the advisory chip but never disables anything", () => {
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "a@1.0" }, // cycle
    ];
    render(
      <SkillsetDependencyGraphCanvas members={MEMBERS} edges={edges} onEdgesChange={vi.fn()} />,
    );
    expect(screen.getByTestId("cycle-warning")).toBeInTheDocument();
    // Editing still works — both surfaces are present.
    expect(screen.getByTestId("graph-columns")).toBeInTheDocument();
    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
  });
});

describe("#1064 contract: no skill-mutation / closure import in the canvas", () => {
  it("the canvas source imports no skill-mutation or closure hook", () => {
    const raw = readFileSync(
      join(__dirname, "SkillsetDependencyGraphCanvas.tsx"),
      "utf8",
    );
    // Strip comments first so the contract prose doesn't trip the scanner — we
    // assert against the actual CODE only.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
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

describe("Forge-token re-pointing: every referenced --color-* token is defined", () => {
  // The canvas CSS re-points react-flow's `--xy-*` vars at Forge semantic
  // tokens with bare `var(--color-…)` (no fallback). If a referenced token
  // name doesn't exist in the design tokens, the var resolves to empty and
  // react-flow silently falls back to its off-brand stock palette — and CSS
  // alone is valid, so lint/typecheck/build/jsdom never catch it. This guard
  // does: it fails if the CSS names a token the design system doesn't define.
  it("the canvas CSS only references --color tokens defined in neon.css", () => {
    const css = readFileSync(join(__dirname, "skillset-depgraph-canvas.css"), "utf8");
    const tokensCss = readFileSync(
      join(__dirname, "..", "..", "styles", "neon.css"),
      "utf8",
    );

    const referenced = [...css.matchAll(/var\(\s*(--color-[\w-]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0); // sanity: the overrides exist

    const defined = new Set(
      [...tokensCss.matchAll(/(--color-[\w-]+)\s*:/g)].map((m) => m[1]),
    );

    const undefinedTokens = [...new Set(referenced)].filter((t) => !defined.has(t));
    expect(undefinedTokens, `undefined design tokens referenced: ${undefinedTokens.join(", ")}`).toEqual(
      [],
    );
  });
});
