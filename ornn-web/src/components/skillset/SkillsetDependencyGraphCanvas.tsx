/**
 * SkillsetDependencyGraphCanvas — the EDITOR surface for the member-dependency
 * graph (#1064, #1067). Lazy-loaded by `SkillsetDependencyGraph` so the
 * ~150 KB `@xyflow/react` chunk is fetched ONLY when the create/edit form
 * mounts — never on the read-only detail page (which keeps Mermaid).
 *
 * Two coupled editing surfaces, one controlled `edges` projection:
 *   1. A drag-on-canvas `<ReactFlow>` graph. Node x/y are SEEDED from the
 *      existing deterministic `topoColumns` layout (positions are NOT persisted
 *      — they're presentation only). Dragging a connection (`onConnect`) adds
 *      `{ from, to }`; deleting an edge on the canvas (`onEdgesDelete`) removes
 *      it. Self-loops are dropped.
 *   2. A click-to-connect node grid + removable edge chips. This is the
 *      keyboard-accessible, jsdom-testable mirror of the same wiring — click a
 *      source member, then a target, to declare "runs before".
 *
 * Both surfaces emit through the SAME `onEdgesChange` callback. A cheap DFS
 * cycle check surfaces a NON-BLOCKING advisory chip.
 *
 * CONTRACT (AC-enforced, #1064 / #1067):
 *   - This component edits NOTHING but its own `edges` projection. Its only
 *     output is `onEdgesChange`. It imports NO skill-mutation hook and NO
 *     closure hook — the grep-guard test asserts the source has no such import.
 *   - Edges are owned by the parent (`SkillsetForm`), persisted inside the
 *     skillset's `instructions` master prompt. This is a pure controlled view.
 *
 * CUT (deliberately, per #1067 scope): minimap, react-flow Controls, custom
 * node theming beyond DESIGN tokens, edge-label editing, and multi-select.
 *
 * @module components/skillset/SkillsetDependencyGraphCanvas
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  type Node,
  type Edge as FlowEdge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// Forge-palette overrides for react-flow's `--xy-*` vars — imported AFTER the
// stock stylesheet so the token re-pointing wins the cascade (#1067).
import "./skillset-depgraph-canvas.css";
import { parseMemberRef } from "@/types/skillset";
import type { Edge } from "@/lib/skillsetDeps";

export interface SkillsetDependencyGraphCanvasProps {
  /** Current member refs (`name@version`). */
  members: string[];
  /** Current dependency edges (a projection of `instructions`). */
  edges: Edge[];
  /** Emitted with the next edge set on every editor mutation. */
  onEdgesChange: (edges: Edge[]) => void;
}

/** Has edge `from → to` already (exact ref match)? */
function hasEdge(edges: Edge[], from: string, to: string): boolean {
  return edges.some((e) => e.from === from && e.to === to);
}

/**
 * Deterministic Kahn topological column assignment. Returns a `column` per
 * member ref; nodes with no remaining in-edges sit in the lowest free column,
 * ties broken alphabetically by ref. Members in a cycle (never reach
 * in-degree 0) are parked in a final column so the layout is total.
 */
function topoColumns(members: string[], edges: Edge[]): Map<string, number> {
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const m of members) {
    indeg.set(m, 0);
    out.set(m, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  const column = new Map<string, number>();
  const remaining = new Set(members);
  let col = 0;
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((m) => (indeg.get(m) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
    if (ready.length === 0) {
      // Cycle: park the rest in this column, alphabetically, and stop.
      [...remaining]
        .sort((a, b) => a.localeCompare(b))
        .forEach((m) => column.set(m, col));
      break;
    }
    for (const m of ready) {
      column.set(m, col);
      remaining.delete(m);
      for (const nbr of out.get(m) ?? []) {
        indeg.set(nbr, (indeg.get(nbr) ?? 0) - 1);
      }
    }
    col += 1;
  }
  return column;
}

/** Cheap DFS: does the directed edge set contain a cycle? */
function hasCycle(members: string[], edges: Edge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const m of members) adj.set(m, []);
  for (const e of edges) {
    if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from)!.push(e.to);
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(members.map((m) => [m, WHITE]));
  const stack: { ref: string; i: number }[] = [];

  for (const start of members) {
    if (color.get(start) !== WHITE) continue;
    stack.push({ ref: start, i: 0 });
    color.set(start, GREY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const neighbors = adj.get(top.ref) ?? [];
      if (top.i < neighbors.length) {
        const next = neighbors[top.i]!;
        top.i += 1;
        const c = color.get(next);
        if (c === GREY) return true; // back-edge → cycle
        if (c === WHITE) {
          color.set(next, GREY);
          stack.push({ ref: next, i: 0 });
        }
      } else {
        color.set(top.ref, BLACK);
        stack.pop();
      }
    }
  }
  return false;
}

function refLabel(ref: string): { name: string; version: string } {
  return parseMemberRef(ref);
}

/** Pixel pitch for the seeded topological layout (presentation only). */
const COL_GAP = 220;
const ROW_GAP = 80;

export function SkillsetDependencyGraphCanvas({
  members,
  edges,
  onEdgesChange,
}: SkillsetDependencyGraphCanvasProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);

  const cyclic = useMemo(() => hasCycle(members, edges), [members, edges]);
  const columns = useMemo(() => topoColumns(members, edges), [members, edges]);

  // Seed react-flow node positions from the deterministic topo columns. We
  // track per-column row index so members in the same column stack vertically.
  // Positions are NOT persisted — they exist only to lay out the canvas.
  const flowNodes: Node[] = useMemo(() => {
    const rowInCol = new Map<number, number>();
    return members.map((ref) => {
      const col = columns.get(ref) ?? 0;
      const row = rowInCol.get(col) ?? 0;
      rowInCol.set(col, row + 1);
      const { name, version } = refLabel(ref);
      return {
        id: ref,
        position: { x: col * COL_GAP, y: row * ROW_GAP },
        data: { label: version ? `${name}@${version}` : name },
      } satisfies Node;
    });
  }, [members, columns]);

  const flowEdges: FlowEdge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
      })),
    [edges],
  );

  // ── react-flow: a dragged connection adds an edge.
  const onConnect = useCallback(
    (conn: Connection) => {
      const from = conn.source;
      const to = conn.target;
      if (!from || !to) return;
      if (from === to) return; // self-loop — a node can't depend on itself.
      if (hasEdge(edges, from, to)) return; // dedup.
      onEdgesChange([...edges, { from, to }]);
    },
    [edges, onEdgesChange],
  );

  // ── react-flow: deleting edge(s) on the canvas removes them.
  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      const drop = new Set(deleted.map((d) => `${d.source}->${d.target}`));
      onEdgesChange(edges.filter((e) => !drop.has(`${e.from}->${e.to}`)));
    },
    [edges, onEdgesChange],
  );

  // ── click-to-connect mirror (keyboard-accessible + jsdom-testable).
  function clickNode(ref: string) {
    if (source === null) {
      setSource(ref);
      return;
    }
    if (source === ref) {
      setSource(null); // self-click — no-op.
      return;
    }
    if (!hasEdge(edges, source, ref)) {
      onEdgesChange([...edges, { from: source, to: ref }]);
    }
    setSource(null);
  }

  function removeEdge(target: Edge) {
    onEdgesChange(edges.filter((e) => !(e.from === target.from && e.to === target.to)));
  }

  // Group members into ordered columns for the click-to-connect grid.
  const maxCol = members.reduce((m, ref) => Math.max(m, columns.get(ref) ?? 0), 0);
  const grid: string[][] = Array.from({ length: maxCol + 1 }, () => []);
  for (const ref of members) {
    grid[columns.get(ref) ?? 0]!.push(ref);
  }
  for (const colMembers of grid) colMembers.sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {/* Drag-on-canvas react-flow surface. */}
      <div
        className="skillset-depgraph-canvas h-[280px] overflow-hidden rounded-sm border border-subtle bg-elevated/30"
        data-testid="graph-canvas"
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          fitView
          nodesConnectable
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>
      </div>

      {/* Click-to-connect node grid — keyboard-accessible mirror. */}
      <div
        className="flex gap-4 overflow-x-auto rounded-sm border border-subtle bg-elevated/30 p-3"
        data-testid="graph-columns"
      >
        {grid.map((colMembers, colIdx) => (
          <div key={colIdx} className="flex shrink-0 flex-col gap-2">
            {colMembers.map((ref) => {
              const { name, version } = refLabel(ref);
              const isSource = source === ref;
              return (
                <button
                  key={ref}
                  type="button"
                  onClick={() => clickNode(ref)}
                  aria-pressed={isSource}
                  className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-xs transition-colors cursor-pointer ${
                    isSource
                      ? "border-accent bg-accent/20 text-strong"
                      : "border-subtle bg-card text-strong hover:border-accent hover:bg-accent/10"
                  }`}
                >
                  <span className="max-w-[12rem] truncate">{name}</span>
                  {version && <span className="text-meta">@{version}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {source !== null && (
        <span className="font-mono text-[10px] text-accent" aria-live="polite">
          {t("skillsetGraph.pickTarget", "Pick a target for {{ref}}…", { ref: source })}
        </span>
      )}

      {/* Cycle advisory (non-blocking). */}
      {cyclic && (
        <p
          className="inline-flex items-center gap-1.5 rounded-sm border border-warning/40 bg-warning-soft px-2.5 py-1 font-mono text-[11px] text-warning"
          role="status"
          data-testid="cycle-warning"
        >
          {t("skillsetGraph.cycleWarning", "Members form a cycle — order is advisory.")}
        </p>
      )}

      {/* Edge chips. */}
      {edges.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-testid="edge-chips">
          {edges.map((e) => (
            <li key={`${e.from}->${e.to}`}>
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-2 py-1 font-mono text-[11px] text-strong">
                <span className="truncate max-w-[16rem]">
                  {e.from} <span className="text-meta">→</span> {e.to}
                </span>
                <button
                  type="button"
                  onClick={() => removeEdge(e)}
                  className="text-danger hover:text-danger/80 cursor-pointer"
                  aria-label={t("skillsetGraph.removeEdge", "Remove edge {{from}} → {{to}}", {
                    from: e.from,
                    to: e.to,
                  })}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
