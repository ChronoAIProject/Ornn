/**
 * SkillsetDetailPage — Editorial Forge layout (DESIGN.md) for one skillset.
 *
 * `?version` resolves which published version is shown (latest by default).
 * Surfaces: name / description / kind / master prompt (rendered markdown) /
 * members / resolved closure / version picker / visibility. Owner gets the
 * Edit, Manage-permissions, and Delete affordances; the actual permissions
 * modal + delete flow are wired in the next commit (this page exposes the
 * triggers).
 *
 * @module pages/SkillsetDetailPage
 */

import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RailCard } from "@/components/detail/RailCard";
import { ReadmeViewer } from "@/components/skill/ReadmeViewer";
import { SkillVisibilityCard } from "@/components/skill/SkillVisibilityCard";
import { VersionPicker } from "@/components/skill/VersionPicker";
import { SkillsetHeroStrip } from "@/components/skillset/SkillsetHeroStrip";
import { SkillsetClosureViewer } from "@/components/skillset/SkillsetClosureViewer";
import { SkillsetDependencyGraph } from "@/components/skillset/SkillsetDependencyGraph";
import { SkillsetMemberViewer } from "@/components/skillset/SkillsetMemberViewer";
import { SkillsetPermissionsModal } from "@/components/skillset/SkillsetPermissionsModal";
import { parseDeps } from "@/lib/skillsetDeps";
import { useToastStore } from "@/stores/toastStore";
import { useCurrentUser } from "@/stores/authStore";
import {
  useSkillset,
  useSkillsetVersions,
  useSkillsetClosure,
  useDeleteSkillset,
} from "@/hooks/useSkillsets";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatDateSGT } from "@/utils/formatters";
import { translateError } from "@/utils/translateError";

export function SkillsetDetailPage() {
  const { idOrName } = useParams<{ idOrName: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const user = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const versionParam = searchParams.get("version") || undefined;
  const id = idOrName ?? "";

  const { data: skillset, isLoading, error } = useSkillset(id, versionParam);
  const { data: versions = [] } = useSkillsetVersions(id);
  const { data: closure } = useSkillsetClosure(id, versionParam);

  const [showPermissions, setShowPermissions] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // Hover state for graph nodes (now canvas-based). Shows floating preview dialog.
  // Position tracks cursor for "beside my cursor" placement.
  const [hoveredMemberRef, setHoveredMemberRef] = useState<string | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ clientX: number; clientY: number } | null>(null);

  // Two-id split: delete is GUID-only on the wire; cache cleanup keys on the
  // URL idOrName so the still-mounted detail page doesn't refetch → 404 (#940).
  const deleteMutation = useDeleteSkillset(skillset?.guid ?? "", id);

  if (isLoading) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton lines={10} />
        </div>
      </PageTransition>
    );
  }

  if (error || !skillset) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8">
          <EmptyState
            title={t("skillsetDetail.notFoundTitle", "Skillset not found")}
            description={t(
              "skillsetDetail.notFoundDesc",
              "It may have been deleted, or you may not have access to it.",
            )}
            action={
              <Button onClick={() => navigate("/skillsets")}>
                {t("skillsetDetail.backToRegistry", "Back to skillsets")}
              </Button>
            }
          />
        </div>
      </PageTransition>
    );
  }

  const isOwner = !!user && skillset.createdBy === user.id;
  const latestVersion = versions[0]?.version ?? skillset.latestVersion;

  // Dependency edges are a PROJECTION of the master prompt (#1064) — parsed
  // read-only here; no write path, no new API call.
  const depEdges = parseDeps(skillset.instructions).edges;

  function handleVersionChange(versionOrLatest: string | null) {
    const next = new URLSearchParams(searchParams);
    if (versionOrLatest === null) next.delete("version");
    else next.set("version", versionOrLatest);
    setSearchParams(next);
  }

  async function handleDeleteConfirm() {
    try {
      await deleteMutation.mutateAsync();
      addToast({ type: "success", message: t("skillsetDetail.deleteSuccess", "Skillset deleted") });
      setShowDelete(false);
      navigate("/skillsets");
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  return (
    <PageTransition>
      <div className="bg-page text-body h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-4 pb-16 sm:px-6 lg:px-8">
          <nav className="shrink-0">
            <BackLink label={t("common.back", "Back")} />
          </nav>

          {/* Hero — name, kind, visibility, owner actions (edit only; version moved to right rail card). */}
          <SkillsetHeroStrip
            skillset={skillset}
            isOwner={isOwner}
            onEdit={isOwner ? () => navigate(`/skillsets/${skillset.guid}/edit`) : undefined}
          />

          {/* Consensus claim disclaimer (consensus-supported kind only). */}
          {skillset.kind === "consensus-supported" && (
            <p className="rounded-sm border border-info/40 bg-info-soft px-3 py-2 font-text text-xs text-info">
              {t(
                "skillsetDetail.consensusNote",
                "The author asserts these members are an independent, comparable set suitable for agent-side consensus. This is a claim, not a platform guarantee.",
              )}
            </p>
          )}

          {/* Master prompt (#1082) — the skillset's "how to use" entry point,
              as the TOPMOST full-width card right under the hero. */}
          <RailCard
            title={t("skillsetDetail.masterPrompt", "Master prompt")}
            icon={
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            }
          >
            {skillset.instructions ? (
              <div className="max-h-64 overflow-y-auto text-[13px] leading-[1.55]">
                <ReadmeViewer content={skillset.instructions} />
              </div>
            ) : (
              <p className="font-text text-sm text-meta italic">
                {t("skillsetDetail.noPrompt", "No master prompt for this version.")}
              </p>
            )}
          </RailCard>

          {/* Workshop: left column is now *only* the member-dependency graph (full height,
              no permanent package viewer below it). The graph uses the entire vertical
              space in the equal-height left column. Package preview for a member appears
              as a floating dialog on hover over a node in the graph (see onHoverMember). */}
          <main className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:h-[calc(100vh-280px)] lg:min-h-[480px]">
            <div className="flex min-w-0 flex-col lg:flex-1 lg:min-h-0 lg:min-w-0">
              {/* Member-dependency graph (#1064) — read-only Mermaid projection of the
                  master prompt's managed deps. Takes the *full* left column height now
                  (previous package viewer below was removed per feedback to let the
                  diagram utilize the canvas). Hover a node to see its package in a
                  floating dialog. */}
              <RailCard
                title={t("skillsetGraph.sectionTitle", "Member dependencies")}
                icon={
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="6" cy="6" r="2.5" />
                    <circle cx="18" cy="6" r="2.5" />
                    <circle cx="12" cy="18" r="2.5" />
                    <path d="M7.7 7.7 10.6 16M16.3 7.7 13.4 16" />
                  </svg>
                }
                className="flex-1 min-h-0 !p-2 flex flex-col relative"
              >
                <SkillsetDependencyGraph
                  readOnly
                  members={skillset.members}
                  edges={depEdges}
                  className="h-full"
                  onHoverMember={(ref, pos) => {
                    setHoveredMemberRef(ref);
                    setHoveredPos(pos || null);
                  }}
                />

                {/* Floating package preview dialog for the hovered graph node.
                    Positioned fixed beside the cursor (offset right+down) so it appears
                    "right beside my cursor". Larger size for better readability of the
                    package tree + content. Uses canvas node hover (no more blinking from
                    SVG/Mermaid). Dismiss on mouseleave of the popup. */}
                {hoveredMemberRef && hoveredPos && (
                  <div
                    className="fixed z-[100] w-[460px] max-h-[420px] overflow-auto rounded-md border border-subtle bg-card card-impression p-3 text-sm shadow-xl"
                    style={{
                      left: hoveredPos.clientX + 18,
                      top: hoveredPos.clientY + 8,
                    }}
                    onMouseLeave={() => {
                      setHoveredMemberRef(null);
                      setHoveredPos(null);
                    }}
                  >
                    <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-meta">
                      <span className="truncate font-medium">{hoveredMemberRef}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setHoveredMemberRef(null);
                          setHoveredPos(null);
                        }}
                        className="text-meta hover:text-danger"
                        aria-label="Close preview"
                      >
                        ×
                      </button>
                    </div>
                    <SkillsetMemberViewer
                      members={skillset.members}
                      previewRef={hoveredMemberRef}
                    />
                  </div>
                )}
              </RailCard>
            </div>

            <aside className="flex flex-col gap-4 lg:w-[320px] lg:shrink-0 lg:h-full lg:overflow-y-auto">
              {/* ── Metadata card ── matches skill details page styling/structure */}
              <section className="rounded-md border border-subtle bg-card p-5 card-impression">
                <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                  {t("skillsetDetail.metadata", "Metadata")}
                </h3>

                <dl className="space-y-2.5 font-text text-sm text-body">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillsetDetail.membersLabel", "Members")}
                    </dt>
                    <dd className="font-mono text-xs text-strong">{skillset.members.length}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillsetDetail.version", "Version")}
                    </dt>
                    <dd className="font-mono text-xs text-strong">
                      {skillset.version}
                      {skillset.version === latestVersion && (
                        <span className="ml-1 text-meta">({t("skillsetDetail.latest", "latest")})</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillsetDetail.versionsCount", "Versions")}
                    </dt>
                    <dd className="font-mono text-xs text-strong">{versions.length}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillsetDetail.updated", "Updated")}
                    </dt>
                    <dd className="font-mono text-xs text-strong">
                      {formatDateSGT(skillset.updatedOn, i18n.language)}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-1 font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillsetDetail.guid", "GUID")}
                    </dt>
                    <dd>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== "undefined" && navigator.clipboard) {
                            void navigator.clipboard.writeText(skillset.guid);
                            addToast({
                              type: "success",
                              message: t("skillsetDetail.guidCopied", "GUID copied") as string,
                            });
                          }
                        }}
                        className="block w-full truncate rounded-sm border border-subtle bg-elevated px-2 py-1 text-left font-mono text-[11px] text-body transition-colors hover:border-strong-edge hover:text-strong"
                        title={skillset.guid}
                      >
                        {skillset.guid}
                      </button>
                    </dd>
                  </div>
                </dl>
              </section>

              {/* ── Versions card ── exact same structure as SkillVersionsCard in skill details page */}
              {versions.length > 0 && (
                <RailCard
                  title={t("skillDetail.cardVersions", "Versions")}
                  icon={
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  }
                >
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="font-display text-2xl font-semibold tracking-tight text-strong">
                      {skillset.version}
                    </span>
                    {skillset.version === latestVersion && (
                      <span className="rounded-sm border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                        {t("skillDetail.latest", "latest")}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
                    {t("skillDetail.heroPublishedOn", "Published {{date}}", { date: formatDateSGT(skillset.createdOn, i18n.language) })}
                    {versions.length > 1 && (
                      <>
                        {" · "}
                        {t("skillDetail.versionsTotal", "{{n}} versions total", { n: versions.length })}
                      </>
                    )}
                  </p>
                  <div className="mt-3.5 flex flex-col gap-2">
                    <VersionPicker
                      versions={versions}
                      currentVersion={skillset.version}
                      onChange={handleVersionChange}
                    />
                  </div>
                </RailCard>
              )}

              {/* Closure (renamed from "Resolved closure") — the complete flattened list of
                  direct members + all their transitive dependencies (topo-sorted for install).
                  "Closure" is the standard term for the fully expanded dependency set. */}
              <RailCard
                title={t("skillsetDetail.resolvedClosure", "Closure")}
                icon={
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                }
              >
                <SkillsetClosureViewer items={closure?.items ?? []} />
              </RailCard>

              {/* ── Visibility card ── use the exact same component as skill details for visual parity */}
              <SkillVisibilityCard
                isPrivate={skillset.isPrivate}
                sharedWithUsersCount={skillset.sharedWithUsers.length}
                sharedWithOrgsCount={skillset.sharedWithOrgs.length}
                isOwner={isOwner}
                onManagePermissions={() => setShowPermissions(true)}
              />

              {/* ── Danger zone (owner only) ── matches skill details page exactly in structure/styling */}
              {isOwner && (
                <section className="rounded-md border border-subtle bg-card p-5 card-impression">
                  <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-danger/30 pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-danger">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {t("skillsetDetail.dangerZone", "Danger zone")}
                  </h3>
                  <p className="mb-3 font-mono text-[11px] leading-relaxed text-meta">
                    {t(
                      "skillsetDetail.dangerExplain",
                      "Permanently delete this skillset and every version. This cannot be undone.",
                    )}
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowDelete(true)}
                  >
                    {t("skillsetDetail.deleteSkillset", "Delete skillset")}
                  </Button>
                </section>
              )}
            </aside>
          </main>
        </div>
      </div>

      {/* Permissions editor (owner only). */}
      {isOwner && (
        <SkillsetPermissionsModal
          isOpen={showPermissions}
          onClose={() => setShowPermissions(false)}
          skillset={skillset}
        />
      )}

      {/* Delete confirmation. */}
      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDeleteConfirm}
        variant="danger"
        title={t("skillsetDetail.deleteTitle", "Delete this skillset?")}
        description={t(
          "skillsetDetail.deleteConfirm",
          "This permanently deletes {{name}} and all its versions.",
          { name: skillset.name },
        )}
        confirmLabel={t("common.delete")}
        isLoading={deleteMutation.isPending}
      />
    </PageTransition>
  );
}
