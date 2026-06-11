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

          {/* Hero — name, kind, visibility, version picker, owner actions. */}
          <SkillsetHeroStrip
            skillset={skillset}
            isOwner={isOwner}
            versionPicker={
              versions.length > 0 ? (
                <VersionPicker
                  versions={versions}
                  currentVersion={skillset.version}
                  onChange={handleVersionChange}
                />
              ) : undefined
            }
            onEdit={isOwner ? () => navigate(`/skillsets/${skillset.guid}/edit`) : undefined}
            onManagePermissions={isOwner ? () => setShowPermissions(true) : undefined}
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

          {/* Main grid: left = master prompt + deps + closure; right = members +
              meta. Mirrors SkillDetailPage — on lg+ the grid is locked to a
              viewport-relative height so each column scrolls its own long
              content (master prompt / closure can grow) instead of growing the
              page; on mobile it falls back to natural page flow. */}
          <main className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:h-[calc(100vh-280px)] lg:min-h-[480px]">
            {/* Left pane: member skill-package viewer (#1080) — click a member
                to view its files, like the skill detail page. The master prompt
                + dependency graph + resolved closure now live in the right rail. */}
            <SkillsetMemberViewer members={skillset.members} />

            <aside className="flex flex-col gap-4 lg:w-[320px] lg:shrink-0 lg:min-h-0 lg:overflow-y-auto">
              {/* Metadata — now leads with the master prompt (#1080), the
                  skillset's "how to use" entry point, then the typed fields. */}
              <RailCard
                title={t("skillsetDetail.metadata", "Metadata")}
                icon={
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                }
              >
                {/* Master prompt — rendered markdown, capped + scrollable so a
                    long prompt doesn't dominate the rail. */}
                <div className="mb-4">
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-meta">
                    {t("skillsetDetail.masterPrompt", "Master prompt")}
                  </p>
                  {skillset.instructions ? (
                    <div className="max-h-72 overflow-y-auto rounded-sm border border-subtle bg-elevated/30 px-3 py-2">
                      <ReadmeViewer content={skillset.instructions} />
                    </div>
                  ) : (
                    <p className="font-text text-sm text-meta italic">
                      {t("skillsetDetail.noPrompt", "No master prompt for this version.")}
                    </p>
                  )}
                </div>
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
              </RailCard>

              {/* Member-dependency graph (#1064) — read-only projection of the
                  master prompt's managed deps block. No write path. */}
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
              >
                <SkillsetDependencyGraph readOnly members={skillset.members} edges={depEdges} />
              </RailCard>

              {/* Resolved closure — flat depth-indented list. */}
              <RailCard
                title={t("skillsetDetail.resolvedClosure", "Resolved closure")}
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

              {/* Visibility — owner sees grant counts + manage. */}
              <RailCard title={t("skillsetDetail.visibility", "Visibility")}>
                <p className="font-text text-sm text-body">
                  {skillset.isPrivate
                    ? t("skillsetDetail.visPrivate", "Private")
                    : t("skillsetDetail.visPublic", "Public")}
                </p>
                {skillset.isPrivate && (
                  <p className="mt-1 font-mono text-[11px] text-meta">
                    {t("skillsetDetail.sharedWith", "Shared with {{users}} users · {{orgs}} orgs", {
                      users: skillset.sharedWithUsers.length,
                      orgs: skillset.sharedWithOrgs.length,
                    })}
                  </p>
                )}
                {isOwner && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => setShowPermissions(true)}
                  >
                    {t("skillsetDetail.managePermissions", "Permissions")}
                  </Button>
                )}
              </RailCard>

              {/* Danger zone (owner only). */}
              {isOwner && (
                <RailCard title={t("skillsetDetail.dangerZone", "Danger zone")} tone="danger">
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
                </RailCard>
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
