/**
 * SkillsetDependencyGraphCanvas — the EDITOR surface for the member-dependency
 * graph (#1064, #1067; smoothness pass #1071). Lazy-loaded by
 * `SkillsetDependencyGraph` so the ~150 KB `@xyflow/react` chunk is fetched
 * ONLY when the create/edit form mounts — never on the read-only detail page
 * (which keeps Mermaid).
 *
 * Two coupled editing surfaces, one controlled `edges` projection:
 *   1. A drag-on-canvas `<ReactFlow>` graph. Node x/y live in SESSION-LOCAL
 *      `useNodesState` so a drag STICKS (the prior controlled-without-handler
 *      memo snapped every node home on the next render). Positions are seeded
 *      once from the deterministic `topoColumns` layout and preserved across
 *      edge edits — drawing a dependency never teleports a node. Positions are
 *      presentation only and are NEVER emitted upward (only `onEdgesChange` is).
 *      A manual "Tidy" button is the ONLY path that re-arranges existing nodes.
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
 *     dependency-resolution hook — the grep-guard test asserts the source has
 *     no such import. `useNodesState`/`onNodesChange` is react-flow's OWN node
 *     reducer and is unrelated to the upward `onEdgesChange` prop.
 *   - Edges are owned by the parent (`SkillsetForm`), persisted inside the
 *     skillset's `instructions` master prompt. This is a pure controlled view.
 *
 * CUT (deliberately, per #1067 scope): minimap, custom node theming beyond
 * DESIGN tokens, edge-label editing, and multi-select. (react-flow `Controls`
 * is reinstated in #1071 as the camera-recovery affordance that replaces
 * auto-refit-on-edit.)
 *
 * @module components/skillset/SkillsetDependencyGraphCanvas
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  useNodesState,
  Position,
  MarkerType,
  ConnectionLineType,
  ConnectionMode,
  type Node,
  type NodeProps,
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
  /** Emitted with the next edge set on every editor mutation. (ignored in readOnly) */
  onEdgesChange: (edges: Edge[]) => void;
  /** Display-only mode for detail page (no drag/connect/edit). */
  readOnly?: boolean | undefined;
  /** Hover callback for nodes (used by detail page for package preview dialog).
   *  Second arg is mouse position for cursor-follow popup. */
  onHoverMember?: ((ref: string | null, pos?: { clientX: number; clientY: number }) => void) | undefined;
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

// Stable module-level react-flow config — referenced by identity so react-flow
// never sees a "new object" on re-render (no churn, no v12 re-init warning).
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1, duration: 200 } as const;
const DEFAULT_EDGE_OPTIONS = {
  type: "smoothstep",
  // Subtle flowing dash so the "runs before" direction reads as motion (#1094).
  animated: true,
  // `color` is load-bearing: v12 paints the arrowhead with an INLINE fill that
  // overrides any CSS rule, falling back to stock grey (#b1b1b7) when absent.
  // Pin it to the arc-blue edge token so the marker matches the edge stroke and
  // no stock palette leaks back (same silent-fallback trap as the #1067 vars).
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "var(--color-accent-secondary)",
  },
  // The "runs before" label pill is styled via CSS (.react-flow__edge-text /
  // -textbg) with Forge tokens — see skillset-depgraph-canvas.css (#1094).
} as const;
const CONNECTION_LINE_STYLE = { strokeWidth: 2 } as const;
const PRO_OPTIONS = { hideAttribution: true } as const;
const DELETE_KEYS = ["Backspace", "Delete"];

/** Code-glyph icon for a member skill card (arc-blue, set in CSS). */
const MEMBER_NODE_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

/**
 * Custom Forge "card" node (#1092): a code-glyph icon + the skill name + its
 * version, with left(target)/right(source) connection handles. The card chrome
 * (letterpress hard-offset shadow, hover/selected ember border) lives in
 * skillset-depgraph-canvas.css — this just lays out the content. Replaces
 * react-flow's plain default box node on both the editor + read-only canvas.
 */
const MemberSkillNode = memo(function MemberSkillNode({ data }: NodeProps) {
  const { name, version } = data as { name: string; version?: string };
  return (
    <div className="depgraph-node flex w-[186px] items-center gap-2.5 rounded-lg border border-subtle bg-card px-3 py-2">
      <Handle type="target" position={Position.Left} />
      <span className="depgraph-node-icon flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-strong-edge bg-elevated">
        {MEMBER_NODE_ICON}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12.5px] font-semibold leading-tight text-strong">
          {name}
        </span>
        {version && (
          <span className="mt-0.5 block font-mono text-[10px] leading-none text-meta">v{version}</span>
        )}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

/** Stable nodeTypes map (module-level so react-flow doesn't re-init per render). */
const NODE_TYPES = { memberSkill: MemberSkillNode };

/**
 * Build react-flow nodes for `members` at their topo-column slots, oriented for
 * a left→right flow (source handle right, target handle left). Used for the
 * mount seed, for placing newly-added members, and for the Tidy re-layout.
 */
function buildNodes(members: string[], columns: Map<string, number>): Node[] {
  const rowInCol = new Map<number, number>();
  return members.map((ref) => {
    const col = columns.get(ref) ?? 0;
    const row = rowInCol.get(col) ?? 0;
    rowInCol.set(col, row + 1);
    const { name, version } = refLabel(ref);
    return {
      id: ref,
      type: "memberSkill",
      position: { x: col * COL_GAP, y: row * ROW_GAP },
      data: { name, version, label: version ? `${name}@${version}` : name },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    } satisfies Node;
  });
}

/**
 * Reconcile the live node set against the current members: keep every existing
 * node's position VERBATIM (including user drags), seed newly-added members at
 * their topo slot, and drop removed members. Returns the previous array
 * unchanged when the id set already matches so the members-keyed effect is
 * idempotent (StrictMode-safe) and edge edits never move a node.
 */
function reconcileNodes(prev: Node[], members: string[], columns: Map<string, number>): Node[] {
  const memberSet = new Set(members);
  if (prev.length === members.length && prev.every((n) => memberSet.has(n.id))) {
    return prev;
  }
  const prevById = new Map(prev.map((n) => [n.id, n] as const));
  // A node's id IS its member ref, so an existing node's label + orientation are
  // already correct — keep it wholesale (preserving its user-dragged position).
  // Only brand-new members take a freshly seeded node.
  return buildNodes(members, columns).map((seed) => prevById.get(seed.id) ?? seed);
}

export function SkillsetDependencyGraphCanvas({
  members,
  edges,
  onEdgesChange,
  readOnly = false,
  onHoverMember,
}: SkillsetDependencyGraphCanvasProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);
  // Relationship label rendered on every arrow: source "runs before" target (the
  // canonical skillset-deps semantic). i18n; pill-styled via DEFAULT_EDGE_OPTIONS.
  const edgeLabel = t("skillsetGraph.edgeLabel", "runs before");

  const cyclic = useMemo(() => hasCycle(members, edges), [members, edges]);
  const columns = useMemo(() => topoColumns(members, edges), [members, edges]);

  // Editor hooks are declared unconditionally (required by Rules of Hooks).
  // They run for both read-only and editor paths (extra work in read-only is harmless).
  const initialNodes = useMemo<Node[]>(() => buildNodes(members, topoColumns(members, edges)), [members]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);

  const membersKey = members.join("|");
  useEffect(() => {
    setNodes((prev) => reconcileNodes(prev, members, topoColumns(members, edges)));
  }, [membersKey]);

  const flowEdges: FlowEdge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        label: edgeLabel,
      })),
    [edges, edgeLabel],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const from = conn.source;
      const to = conn.target;
      if (!from || !to) return;
      if (from === to) return;
      if (hasEdge(edges, from, to)) return;
      onEdgesChange([...edges, { from, to }]);
    },
    [edges, onEdgesChange],
  );

  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      const drop = new Set(deleted.map((d) => `${d.source}->${d.target}`));
      onEdgesChange(edges.filter((e) => !drop.has(`${e.from}->${e.to}`)));
    },
    [edges, onEdgesChange],
  );

  const tidy = useCallback(() => {
    const cols = topoColumns(members, edges);
    setNodes((prev) => {
      const rowInCol = new Map<number, number>();
      const byId = new Map(prev.map((n) => [n.id, n] as const));
      return members.map((ref) => {
        const col = cols.get(ref) ?? 0;
        const row = rowInCol.get(col) ?? 0;
        rowInCol.set(col, row + 1);
        const existing = byId.get(ref);
        const base = existing ?? buildNodes([ref], cols)[0]!;
        return { ...base, position: { x: col * COL_GAP, y: row * ROW_GAP } };
      });
    });
  }, [members, edges, setNodes]);

  // Read-only specific memos (also unconditional hooks for consistent hook order).
  const staticNodes = useMemo(
    () =>
      buildNodes(members, columns).map((n) => ({
        ...n,
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    [members, columns]
  );
  const readOnlyFlowEdges: FlowEdge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        label: edgeLabel,
      })),
    [edges, edgeLabel]
  );

  if (readOnly) {
    // Read-only display for detail page: static topo layout, no editing, hover support
    // for the package preview dialog.
    return (
      <div className="skillset-depgraph-canvas h-full min-h-[200px] overflow-hidden rounded-sm border border-subtle bg-elevated/30">
        <ReactFlow
          nodes={staticNodes}
          edges={readOnlyFlowEdges}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          onNodeMouseEnter={(event, node) => {
            if (onHoverMember && node?.id) {
              const pos = event && typeof event.clientX === 'number'
                ? { clientX: event.clientX, clientY: event.clientY }
                : undefined;
              onHoverMember(node.id, pos);
            }
          }}
          onNodeMouseLeave={() => onHoverMember?.(null)}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          proOptions={PRO_OPTIONS}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          minZoom={0.4}
          maxZoom={2}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Lines} gap={26} color="var(--color-border-subtle)" />
          {/* Zoom in / out / fit on the read-only detail graph (#1094). */}
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    );
  }

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
  // (columns and source are declared at top level for hook consistency)
  const maxCol = members.reduce((m, ref) => Math.max(m, columns.get(ref) ?? 0), 0);
  const grid: string[][] = Array.from({ length: maxCol + 1 }, () => []);
  for (const ref of members) {
    grid[columns.get(ref) ?? 0]!.push(ref);
  }
  for (const colMembers of grid) colMembers.sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {/* Canvas header: opt-in Tidy re-layout (the only non-drag reposition). */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          data-testid="graph-tidy"
          onClick={tidy}
          className="inline-flex items-center gap-1.5 rounded-sm border border-subtle bg-card px-2 py-1 font-mono text-[10px] text-meta transition-colors cursor-pointer hover:border-accent hover:text-strong"
        >
          {t("skillsetGraph.tidy", "Tidy")}
        </button>
      </div>

      {/* Drag-on-canvas react-flow surface. */}
      <div
        className="skillset-depgraph-canvas h-[460px] overflow-hidden rounded-sm border border-subtle bg-elevated/30"
        data-testid="graph-canvas"
      >
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.4}
          maxZoom={1.5}
          nodesConnectable
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={CONNECTION_LINE_STYLE}
          connectionRadius={30}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={DELETE_KEYS}
          // The canvas is embedded in a scrolling form — let a plain wheel
          // scroll the PAGE (don't trap it as graph zoom). Zoom stays available
          // via the Controls buttons, pinch, and ⌘/ctrl+wheel (#1074).
          preventScrolling={false}
          proOptions={PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Lines} gap={26} color="var(--color-border-subtle)" />
          {/* bottom-LEFT so the cluster never overlaps a node's right-edge
              (source) handle — the primary drag-to-connect grab target. */}
          <Controls showInteractive={false} position="bottom-left" />
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
