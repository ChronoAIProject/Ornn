/**
 * SkillsetDependencyGraph — visual member-dependency graph for a skillset
 * (#1064).
 *
 * Two modes, one component:
 *   - read-only (`readOnly`): renders the member graph as a Mermaid
 *     `flowchart TD` via the shared `<MermaidBlock>` (pan / zoom / lightbox come
 *     for free). Used on the skillset detail page.
 *   - editor: a deterministic topological-column layout (Kahn ordering →
 *     column; alphabetical tie-break) with click-source-then-click-target to
 *     connect members, removable edge chips, and a live Mermaid preview.
 *
 * CONTRACT (AC-enforced, #1064):
 *   - This component edits NOTHING but its own `edges` projection. Its only
 *     output is `onEdgesChange`. It imports NO skill-mutation hook and NO
 *     closure hook (#968) — a grep-guard test asserts the source has no such
 *     import. Editing the graph must never publish/update a member skill.
 *   - Edges are owned by the parent (`SkillsetForm`), which persists them
 *     inside the skillset's `instructions` master prompt via `serializeDeps`.
 *     This component is a pure controlled view over `{ members, edges }`.
 *
 * A cheap DFS cycle check surfaces a NON-BLOCKING advisory chip — a cycle is
 * allowed (member ordering is advice, not a hard DAG constraint), so submit is
 * never disabled by this component.
 *
 * @module components/skillset/SkillsetDependencyGraph
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MermaidBlock } from "@/components/docs/DocsMermaid";
import { parseMemberRef } from "@/types/skillset";
import { renderFlowchart, type Edge } from "@/lib/skillsetDeps";

export interface SkillsetDependencyGraphProps {
  /** Current member refs (`name@version`). */
  members: string[];
  /** Current dependency edges (a projection of `instructions`). */
  edges: Edge[];
  /** Emitted with the next edge set on every editor mutation. */
  onEdgesChange?: ((edges: Edge[]) => void) | undefined;
  /** Render the read-only Mermaid view (detail page) instead of the editor. */
  readOnly?: boolean | undefined;
  className?: string | undefined;
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

export function SkillsetDependencyGraph({
  members,
  edges,
  onEdgesChange,
  readOnly = false,
  className = "",
}: SkillsetDependencyGraphProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);

  const chart = useMemo(() => renderFlowchart(members, edges), [members, edges]);
  const cyclic = useMemo(() => hasCycle(members, edges), [members, edges]);
  const columns = useMemo(() => topoColumns(members, edges), [members, edges]);

  // ── read-only: just the rendered graph (pan/zoom/lightbox via MermaidBlock).
  if (readOnly) {
    return (
      <div className={className}>
        {members.length === 0 ? (
          <p className="font-text text-sm text-meta italic">
            {t("skillsetGraph.emptyReadonly", "No members to graph.")}
          </p>
        ) : edges.length === 0 ? (
          <p className="font-text text-sm text-meta italic">
            {t(
              "skillsetGraph.emptyDeps",
              "No dependencies declared between members.",
            )}
          </p>
        ) : (
          <MermaidBlock chart={chart} />
        )}
      </div>
    );
  }

  // ── editor.
  function clickNode(ref: string) {
    if (!onEdgesChange) return;
    if (source === null) {
      setSource(ref);
      return;
    }
    if (source === ref) {
      // Self-click — no-op (a node can't depend on itself).
      setSource(null);
      return;
    }
    if (!hasEdge(edges, source, ref)) {
      onEdgesChange([...edges, { from: source, to: ref }]);
    }
    setSource(null);
  }

  function removeEdge(target: Edge) {
    if (!onEdgesChange) return;
    onEdgesChange(edges.filter((e) => !(e.from === target.from && e.to === target.to)));
  }

  // Group members into ordered columns for the layout grid.
  const maxCol = members.reduce((m, ref) => Math.max(m, columns.get(ref) ?? 0), 0);
  const grid: string[][] = Array.from({ length: maxCol + 1 }, () => []);
  for (const ref of members) {
    grid[columns.get(ref) ?? 0]!.push(ref);
  }
  for (const colMembers of grid) colMembers.sort((a, b) => a.localeCompare(b));

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
          {t("skillsetGraph.label", "Dependency graph")}
        </span>
        {source !== null && (
          <span className="font-mono text-[10px] text-accent" aria-live="polite">
            {t("skillsetGraph.pickTarget", "Pick a target for {{ref}}…", { ref: source })}
          </span>
        )}
      </div>

      <p className="font-text text-xs text-meta">
        {t(
          "skillsetGraph.help",
          "Optional. Click a member, then another, to declare “runs before”. Edges are stored inside the master prompt — no skill is modified.",
        )}
      </p>

      {members.length < 2 ? (
        <p className="font-text text-xs text-meta italic">
          {t("skillsetGraph.needMembers", "Add at least two members to draw dependencies.")}
        </p>
      ) : (
        <>
          {/* Topological-column node layout. */}
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

          {/* Cycle advisory (non-blocking). */}
          {cyclic && (
            <p
              className="inline-flex items-center gap-1.5 rounded-sm border border-warning/40 bg-warning-soft px-2.5 py-1 font-mono text-[11px] text-warning"
              role="status"
              data-testid="cycle-warning"
            >
              {t(
                "skillsetGraph.cycleWarning",
                "Members form a cycle — order is advisory.",
              )}
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

          {/* Live preview. */}
          {edges.length > 0 && <MermaidBlock chart={chart} />}
        </>
      )}
    </div>
  );
}
