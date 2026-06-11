/**
 * SkillsetDependencyGraph — visual member-dependency graph for a skillset
 * (#1064, #1067).
 *
 * Two modes, one component:
 *   - read-only (`readOnly`): renders using the react-flow canvas (proper canvas
 *     engine with topo layout, pan/zoom, hover). Used on detail page for full
 *     space utilization and hover-to-preview. Lazy loaded.
 *   - editor: same canvas (with drag/connect). The ~150 KB chunk is fetched when
 *     the form mounts.
 *
 * CONTRACT (AC-enforced, #1064 / #1067):
 *   - This component (and its lazy canvas child) edit NOTHING but their own
 *     `edges` projection. The only output is `onEdgesChange`. Neither imports a
 *     skill-mutation hook nor a closure hook (#968) — a grep-guard test asserts
 *     BOTH source files have no such import. Editing the graph must never
 *     publish/update a member skill.
 *   - Edges are owned by the parent (`SkillsetForm`), which persists them
 *     inside the skillset's `instructions` master prompt via `serializeDeps`.
 *     This component is a pure controlled view over `{ members, edges }`.
 *
 * @module components/skillset/SkillsetDependencyGraph
 */

import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { Edge } from "@/lib/skillsetDeps";

// Lazy so the heavy @xyflow/react chunk only loads on the editor path.
const SkillsetDependencyGraphCanvas = lazy(() =>
  import("@/components/skillset/SkillsetDependencyGraphCanvas").then((m) => ({
    default: m.SkillsetDependencyGraphCanvas,
  })),
);

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
  /** Called when a graph node is hovered (in read-only mode).
   *  Second arg provides mouse position for placing the preview popup beside the cursor. */
  onHoverMember?: ((ref: string | null, pos?: { clientX: number; clientY: number }) => void) | undefined;
}

export function SkillsetDependencyGraph({
  members,
  edges,
  onEdgesChange,
  readOnly = false,
  className = "",
  onHoverMember,
}: SkillsetDependencyGraphProps) {
  const { t } = useTranslation();

  // ── read-only: use the proper react-flow canvas (same as editor but non-interactive
  // display). This gives a real canvas with better space utilization, node layout,
  // hover support, pan/zoom etc. (Mermaid was replaced per request for a "proper
  // canvas"). The chunk is still lazy, now loaded on detail too.
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
          <Suspense
            fallback={
              <p className="font-text text-xs text-meta italic" role="status">
                {t("skillsetGraph.loadingCanvas", "Loading graph…")}
              </p>
            }
          >
            <SkillsetDependencyGraphCanvas
              members={members}
              edges={edges}
              onEdgesChange={() => {}}
              readOnly
              onHoverMember={onHoverMember}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // ── editor: lazy react-flow canvas. With no handler or <2 members there's
  // nothing to draw — keep the cheap guidance copy and skip the heavy chunk.
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
          {t("skillsetGraph.label", "Dependency graph")}
        </span>
      </div>

      <p className="font-text text-xs text-meta">
        {t(
          "skillsetGraph.help",
          "Optional. Drag between members (or click a member, then another) to declare “runs before”. Edges are stored inside the master prompt — no skill is modified.",
        )}
      </p>

      {members.length < 2 || !onEdgesChange ? (
        <p className="font-text text-xs text-meta italic">
          {t("skillsetGraph.needMembers", "Add at least two members to draw dependencies.")}
        </p>
      ) : (
        <Suspense
          fallback={
            <p className="font-text text-xs text-meta italic" role="status">
              {t("skillsetGraph.loadingCanvas", "Loading graph editor…")}
            </p>
          }
        >
          <SkillsetDependencyGraphCanvas
            members={members}
            edges={edges}
            onEdgesChange={onEdgesChange}
          />
        </Suspense>
      )}
    </div>
  );
}
