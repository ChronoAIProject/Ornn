/**
 * skillsetDeps codec — round-trip + prune + forward-compat contract (#1064).
 *
 * @module lib/skillsetDeps.test
 */

import { describe, it, expect } from "vitest";
import {
  parseDeps,
  serializeDeps,
  pruneEdges,
  deriveNodes,
  renderFlowchart,
  type Edge,
} from "./skillsetDeps";

describe("parseDeps / serializeDeps round-trip", () => {
  it("serialize(parse(x)) === x for a canonical serialized prompt", () => {
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@2.0" },
      { from: "b@2.0", to: "c@1.0" },
    ];
    const x = serializeDeps("Use A first, then B, then C.", edges);
    const round = serializeDeps(parseDeps(x).promptBody, parseDeps(x).edges);
    expect(round).toBe(x);
  });

  it("recovers the exact edge set", () => {
    const edges: Edge[] = [
      { from: "alpha@1.0", to: "beta@1.0" },
      { from: "beta@1.0", to: "gamma@3.2" },
    ];
    const x = serializeDeps("prose", edges);
    expect(parseDeps(x).edges).toEqual(edges);
  });

  it("a same-name different-version edge survives a round-trip", () => {
    const edges: Edge[] = [{ from: "dup@1.0", to: "dup@2.0" }];
    const x = serializeDeps("body", edges);
    const parsed = parseDeps(x);
    expect(parsed.edges).toEqual(edges);
    // The two endpoints are DISTINCT nodes (name matches, version differs).
    expect(parsed.edges[0]?.from).toBe("dup@1.0");
    expect(parsed.edges[0]?.to).toBe("dup@2.0");
  });

  it("no edges → serialize returns the prose body alone (no empty block)", () => {
    expect(serializeDeps("just prose", [])).toBe("just prose");
    expect(parseDeps("just prose")).toEqual({ edges: [], promptBody: "just prose" });
  });
});

describe("prose preservation (byte-identical)", () => {
  it("preserves prose that itself contains ``` fences", () => {
    const prose = "# Title\n\n```ts\nconst x = 1;\n```\n\nMore text.";
    const edges: Edge[] = [{ from: "a@1.0", to: "b@1.0" }];
    const x = serializeDeps(prose, edges);
    expect(parseDeps(x).promptBody).toBe(prose);
  });

  it("preserves prose that contains <!-- HTML comments -->", () => {
    const prose = "Intro <!-- a note --> middle\n<!-- another -->\nend";
    const edges: Edge[] = [{ from: "x@1.0", to: "y@1.0" }];
    const x = serializeDeps(prose, edges);
    expect(parseDeps(x).promptBody).toBe(prose);
  });

  it("preserves prose that mentions the marker text in code, not as a real block", () => {
    // A lone start marker with no matching end marker is NOT a managed block →
    // the whole string is prose, returned verbatim.
    const prose = "Talking about <!-- ornn:deps:start --> in docs.";
    const parsed = parseDeps(prose);
    expect(parsed.edges).toEqual([]);
    expect(parsed.promptBody).toBe(prose);
  });
});

describe("forward-compat: absent / unknown / garbled blocks never throw", () => {
  it("absent block → edges:[] + verbatim body", () => {
    const s = "plain instructions with no graph";
    expect(() => parseDeps(s)).not.toThrow();
    expect(parseDeps(s)).toEqual({ edges: [], promptBody: s });
  });

  it("garbled block (non-edge lines inside) → ignores junk, keeps valid edges, no throw", () => {
    const s = [
      "Prose.",
      "",
      "<!-- ornn:deps:start -->",
      "```mermaid",
      "flowchart TD",
      "  garbage line that is not an edge",
      '  n0["a@1.0"] --> n1["b@1.0"]',
      "  another junk ;;;",
      "```",
      "<!-- ornn:deps:end -->",
    ].join("\n");
    let parsed!: ReturnType<typeof parseDeps>;
    expect(() => { parsed = parseDeps(s); }).not.toThrow();
    expect(parsed.edges).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
  });

  it("empty managed block → edges:[] + prose preserved, no throw", () => {
    const s = "Body.\n\n<!-- ornn:deps:start -->\n<!-- ornn:deps:end -->";
    let parsed!: ReturnType<typeof parseDeps>;
    expect(() => { parsed = parseDeps(s); }).not.toThrow();
    expect(parsed.edges).toEqual([]);
    expect(parsed.promptBody).toBe("Body.");
  });
});

describe("pruneEdges", () => {
  const members = ["a@1.0", "b@1.0", "c@1.0"];

  it("drops edges whose endpoints aren't current members", () => {
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" }, // keep
      { from: "a@1.0", to: "gone@1.0" }, // drop (target removed)
      { from: "ghost@1.0", to: "b@1.0" }, // drop (source removed)
    ];
    expect(pruneEdges(edges, members)).toEqual([{ from: "a@1.0", to: "b@1.0" }]);
  });

  it("drops self-loops (same name+version both ends)", () => {
    const edges: Edge[] = [{ from: "a@1.0", to: "a@1.0" }];
    expect(pruneEdges(edges, members)).toEqual([]);
  });

  it("dedups repeated edges (first wins)", () => {
    const edges: Edge[] = [
      { from: "a@1.0", to: "b@1.0" },
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "c@1.0" },
    ];
    expect(pruneEdges(edges, members)).toEqual([
      { from: "a@1.0", to: "b@1.0" },
      { from: "b@1.0", to: "c@1.0" },
    ]);
  });

  it("a@1.0→b@1.0 keeps when both present; same-name/diff-version is a distinct member", () => {
    const ms = ["dup@1.0", "dup@2.0"];
    const edges: Edge[] = [{ from: "dup@1.0", to: "dup@2.0" }];
    // Both endpoints are members AND they are NOT a self-loop (versions differ).
    expect(pruneEdges(edges, ms)).toEqual([{ from: "dup@1.0", to: "dup@2.0" }]);
  });

  it("never mutates the input array", () => {
    const edges: Edge[] = [{ from: "a@1.0", to: "a@1.0" }];
    const snapshot = JSON.parse(JSON.stringify(edges));
    pruneEdges(edges, members);
    expect(edges).toEqual(snapshot);
  });
});

describe("deriveNodes / renderFlowchart", () => {
  it("deriveNodes assigns positional ids in member order", () => {
    expect(deriveNodes(["a@1.0", "b@2.0"])).toEqual([
      { ref: "a@1.0", id: "n0" },
      { ref: "b@2.0", id: "n1" },
    ]);
  });

  it("renderFlowchart declares every member (isolated members included)", () => {
    const chart = renderFlowchart(["a@1.0", "b@1.0", "iso@1.0"], [
      { from: "a@1.0", to: "b@1.0" },
    ]);
    expect(chart).toContain("flowchart TD");
    expect(chart).toContain('n0["a@1.0"]');
    expect(chart).toContain('n1["b@1.0"]');
    expect(chart).toContain('n2["iso@1.0"]'); // isolated, still declared
    expect(chart).toContain("n0 --> n1");
  });
});
