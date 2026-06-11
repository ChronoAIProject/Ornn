/**
 * SkillsetDependencyGraph — visual member-dependency graph for a skillset
 * (#1064, #1067).
 *
 * Two modes, one component:
 *   - read-only (`readOnly`): renders the member graph as a Mermaid
 *     `flowchart TD` via the shared `<MermaidBlock>` (pan / zoom / lightbox come
 *     for free). Used on the skillset detail page. The read path NEVER pulls in
 *     react-flow — it stays Mermaid.
 *   - editor: a lazy-loaded `<SkillsetDependencyGraphCanvas>` built on
 *     `@xyflow/react` (#1067). The ~150 KB react-flow chunk is fetched ONLY
 *     when this editor mounts (create/edit form), never on detail/read.
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

import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MermaidBlock } from "@/components/docs/DocsMermaid";
import { renderFlowchart, type Edge } from "@/lib/skillsetDeps";

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
  /** Called when a graph node is hovered (in read-only mode). The ref is matched from the node label. */
  onHoverMember?: ((ref: string | null) => void) | undefined;
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

  const chart = useMemo(() => renderFlowchart(members, edges), [members, edges]);

  // ── read-only: just the rendered graph (pan/zoom/lightbox via MermaidBlock).
  // Caller (SkillsetDetailPage) wires the RailCard with `flex flex-col` + passes
  // `flex-1 min-h-0` as className so this root claims all space *after* the
  // card's h3 header. We forward a tight className to MermaidBlock to nuke its
  // default my-4/p-4/minHeight/rounded/bg-page (the source of the "small diagram
  // in lots of wasted chrome" complaint). The SandboxedSvg + 100% svg then
  // spans nearly the entire allocated height/width of the member deps area.
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
          <MermaidBlock
            chart={chart}
            direct
            onNodeHover={(label) => {
              if (!onHoverMember) return;
              if (!label) {
                onHoverMember(null);
                return;
              }
              const clean = label.replace(/["\s]/g, '');
              const matched = members.find((m) => {
                const mclean = m.replace(/["\s]/g, '');
                return clean === mclean || clean.includes(mclean) || mclean.includes(clean);
              });
              onHoverMember(matched || null);
            }}
            className="my-0 !p-1 min-h-0 h-full bg-transparent"
          />
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
