/**
 * SkillDetailPage — Editorial Forge layout (DESIGN.md).
 *
 * Three vertical regions:
 *   1. Breadcrumbs row
 *   2. Hero strip card — name, description, status pills, owner, primary CTA
 *   3. Pulls strip — usage trend (existing UsagePullsCard)
 *   4. Main 2-col grid:
 *      - Left: tabs (content / audit history) + version dropdown + Save +
 *        SkillPackagePreview (files panel + viewer)
 *      - Right rail: Audit / Visibility / Versions / Danger cards
 *
 * @module pages/skill/SkillDetailPage
 */

import { Link, useParams, useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { useToastStore } from "@/stores/toastStore";
import { isAdmin } from "@/stores/authStore";
import { VersionPicker } from "@/components/skill/VersionPicker";
import { DeprecationBanner } from "@/components/skill/DeprecationBanner";
import { GitHubOriginChip } from "@/components/skill/GitHubOriginChip";
import { SkillInstallCard } from "@/components/skill/SkillInstallCard";
import { UsagePullsCard } from "@/components/skill/UsagePullsCard";
import { SkillHeroStrip } from "@/components/skill/SkillHeroStrip";
import { BackLink } from "@/components/layout/BackLink";
import { AgentSealTrustBadge } from "@/components/agentseal/AgentSealTrustBadge";
import { PermissionsModal } from "@/components/skill/PermissionsModal";
import { AdvancedOptionsModal } from "@/components/skill/AdvancedOptionsModal";
import { VersionDiffModal } from "@/components/skill/VersionDiffModal";
import { SkillSaveConfirmModal } from "@/components/skill/SkillSaveConfirmModal";
import { SkillDeleteConfirmModal } from "@/components/skill/SkillDeleteConfirmModal";
import { TransferOwnershipModal } from "@/components/skill/TransferOwnershipModal";
import { SkillAuditStartedModal } from "@/components/skill/SkillAuditStartedModal";
import { SkillVersionsBrowserModal } from "@/components/skill/SkillVersionsBrowserModal";
import { AuditVerdictPill } from "@/components/skill/AuditVerdictPill";
import {
  SkillDetailLoading,
  SkillDetailNotFound,
} from "@/components/skill/SkillDetailStates";
import { SkillVersionsCard } from "@/components/skill/SkillVersionsCard";
import { SkillVisibilityCard } from "@/components/skill/SkillVisibilityCard";
import { useSkillDetail } from "@/hooks/useSkillDetail";
import { formatDateSGT } from "@/utils/formatters";
import { useTranslation } from "react-i18next";

export function SkillDetailPage() {
  const { idOrName } = useParams<{ idOrName: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const detail = useSkillDetail(idOrName);

  if (detail.isLoading) return <SkillDetailLoading />;
  if (detail.error || !detail.skill) return <SkillDetailNotFound />;

  // Aliases — keeps the JSX below readable without changing the prop
  // wiring. Every name here came out of `useSkillDetail`; the hook is
  // the single source of truth for queries + mutations + handlers.
  const {
    skill,
    refetch,
    versionList,
    latestVersion,
    viewingLatest,
    pullCount7d,
    packageFiles,
    rawZip,
    packageLoading,
    packageError,
    user,
    isAuthenticated,
    isOwner,
    isAdminUser,
    canManageVersions,
    auditSummaryByVersion,
    versionAudit,
    versionAuditRunning,
    versionAuditLatestFailed,
    ownerDisplayName,
    ownerAvatarUrl,
    deleteMutation,
    updatePackageMutation,
    deprecationMutation,
    deleteVersionMutation,
    refreshMutation,
    startAuditMutation,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showPermissionsModal,
    setShowPermissionsModal,
    showTransferModal,
    setShowTransferModal,
    showAdvancedModal,
    setShowAdvancedModal,
    showSaveConfirm,
    setShowSaveConfirm,
    showAuditStartedModal,
    setShowAuditStartedModal,
    showVersions,
    setShowVersions,
    showVersionDiff,
    setShowVersionDiff,
    skipValidation,
    setSkipValidation,
    addedPaths,
    hasChanges,
    mergedContents,
    mergedFiles,
    handleVersionChange,
    handleToggleDeprecation,
    handleContentChange,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFile,
    handleSave,
    handleDeleteConfirm,
    handleDownloadPackage,
    handleStartAudit,
  } = detail;

  return (
    <PageTransition>
      <div className="bg-page text-body h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-4 pb-16 sm:px-6 lg:px-8">

        {/* ── Breadcrumbs ── */}
        <nav className="shrink-0">
          <BackLink label={t("common.back", "Back")} />
        </nav>

        {/* ── Deprecation banner ── */}
        {skill.isDeprecated && (
          <DeprecationBanner
            className="shrink-0"
            version={skill.version}
            note={skill.deprecationNote}
            hasNewerVersion={!viewingLatest && !!latestVersion}
            latestVersion={latestVersion}
            onViewLatest={() => handleVersionChange(null)}
          />
        )}
        {skill.source && (
          <GitHubOriginChip
            className="shrink-0"
            source={skill.source}
            canRefresh={isOwner || isAdminUser}
            isRefreshing={refreshMutation.isPending}
            onRefresh={() => refreshMutation.mutate({ guid: skill.guid })}
          />
        )}

        {/* ── Install card (#411) ── */}
        {/* Visibility follows the skill (#413): if the viewer can see this
            skill detail page they can see the install card. The page-level
            auth + ACL guards already enforce "can this person see this
            skill at all". Both tabs (prompt + npx) only emit public
            metadata so there's no reason to gate further. */}
        <SkillInstallCard className="shrink-0" skill={skill} />

        {/* ── Hero strip ── */}
        <SkillHeroStrip
          skill={skill}
          pullCount7d={pullCount7d}
          versionAudit={versionAudit}
          isAuthenticated={isAuthenticated}
          isOwner={isOwner}
          ownerDisplayName={ownerDisplayName}
          ownerAvatarUrl={ownerAvatarUrl}
          onTryPlayground={() => navigate(`/playground?skill=${encodeURIComponent(skill.name)}`)}
          onDownloadPackage={rawZip ? handleDownloadPackage : undefined}
          onEditSkill={isOwner ? () => navigate(`/skills/${skill.guid}/edit`) : undefined}
        />

        {/* ── Audit-version banner (yellow/red/missing only; green is silent) ── */}
        {(() => {
          const v = versionAudit;
          if (v && v.verdict === "green") return null;
          const tone =
            !v
              ? "border-strong-edge bg-elevated/40 text-meta"
              : v.verdict === "red"
                ? "border-danger/40 bg-danger-soft text-danger"
                : "border-warning/40 bg-warning-soft text-warning";
          const message = !v
            ? t(
                "skillDetail.auditBannerNotAudited",
                "v{{v}} has not been audited yet. Audit results travel as risk labels and notify consumers when a skill flips to risky.",
                { v: skill.version },
              )
            : v.verdict === "red"
              ? t(
                  "skillDetail.auditBannerRed",
                  "Audit verdict for v{{v}} is RED ({{score}}/10). Use with caution.",
                  { v: skill.version, score: v.overallScore.toFixed(1) },
                )
              : t(
                  "skillDetail.auditBannerYellow",
                  "Audit verdict for v{{v}} is YELLOW ({{score}}/10). Some findings flagged.",
                  { v: skill.version, score: v.overallScore.toFixed(1) },
                );
          return (
            <div className={`flex shrink-0 items-center justify-between gap-3 rounded-sm border px-4 py-2 font-text text-xs ${tone}`}>
              <span className="min-w-0 truncate">{message}</span>
              <Link
                to={`/skills/${encodeURIComponent(skill.name || skill.guid)}/audits?version=${encodeURIComponent(skill.version)}`}
                className="shrink-0 rounded-sm border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
              >
                {t("audit.viewHistory", "View history")}
              </Link>
            </div>
          );
        })()}

        {/* ── Pulls strip ── */}
        <UsagePullsCard
          idOrName={skill.name || skill.guid}
          version={skill.version}
          className="shrink-0"
        />

        {/* ── Main grid ── */}
        {/* Two-column layout (lg+). On lg+, the grid is fixed to a
            viewport-relative height so each column can scroll its own
            long content without growing the page. `lg:h-[calc(100vh-Y)]`
            absorbs roughly the top nav + breadcrumb + hero + version
            banner above; `lg:min-h-[480px]` keeps it usable on short
            viewports. On mobile we fall back to natural page-flow
            (no fixed height, no inner scroll — let the OS scroll). */}
        <main className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:h-[calc(100vh-280px)] lg:min-h-[480px]">

          {/* Left: tabs + content. Inner overflow is owned by
              SkillPackagePreview which gets `h-full`; this section
              just needs `min-h-0` so the flex sizing math works. */}
          <section className="card-impression flex min-h-[420px] flex-col overflow-hidden rounded border border-subtle bg-card lg:flex-1 lg:min-h-0 lg:min-w-0">
            {/* Toolbar — VersionPicker carries its own "Version" label, so
                no outer label here (we used to render two). Audit history
                lives in the right-rail card now. */}
            <div className="flex shrink-0 items-center justify-between border-b border-subtle bg-elevated px-4 py-3">
              <div className="flex items-center gap-3">
                {versionList.length > 0 && (
                  <VersionPicker
                    versions={versionList}
                    currentVersion={skill.version}
                    onChange={handleVersionChange}
                  />
                )}
              </div>
              {isOwner && (
                <Button
                  size="sm"
                  onClick={() => setShowSaveConfirm(true)}
                  disabled={!hasChanges}
                  loading={updatePackageMutation.isPending}
                >
                  {t("common.save")}
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-0">
              {packageLoading ? (
                <div className="p-6"><Skeleton lines={8} /></div>
              ) : packageError ? (
                <p className="py-12 text-center font-text text-sm text-meta">
                  {t("skillDetail.failedPackage")}
                </p>
              ) : packageFiles.length > 0 || addedPaths.length > 0 ? (
                <SkillPackagePreview
                  files={mergedFiles}
                  fileContents={mergedContents}
                  metadata={null}
                  editable={isOwner}
                  onContentChange={handleContentChange}
                  onCreateFile={isOwner ? handleCreateFile : undefined}
                  onCreateFolder={isOwner ? handleCreateFolder : undefined}
                  onFileDelete={isOwner ? handleDeleteFile : undefined}
                  className="h-full"
                />
              ) : (
                <p className="py-12 text-center font-text text-sm text-meta">
                  {t("skillDetail.noPackage")}
                </p>
              )}
            </div>
          </section>

          {/* Right rail — on lg+, scrolls its own content (audit
              history, version list, danger zone can all grow long).
              `lg:min-h-0` + `lg:overflow-y-auto` flips this from
              "page-grows-with-cards" to "rail scrolls inside the
              fixed-height main grid". */}
          <aside className="flex flex-col gap-4 lg:w-[320px] lg:shrink-0 lg:min-h-0 lg:overflow-y-auto">

            {/* ── Audit card ── */}
            <section className="rounded-md border border-subtle bg-card p-5 card-impression">
              <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                {t("skillDetail.cardAudit", "Audit")}
              </h3>
              <AuditVerdictPill
                audit={versionAudit}
                running={versionAuditRunning}
                latestRerunFailed={versionAuditLatestFailed}
              />
              <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
                {versionAuditRunning
                  ? t("skillDetail.auditRunningHint", "Scoring against the audit engine — this usually takes 30–60 seconds.")
                  : versionAudit?.completedAt
                    ? t("skillDetail.auditLast", "Last audited {{date}}", { date: formatDateSGT(versionAudit.completedAt, i18n.language) })
                    : t("skillDetail.auditNoneYet", "Not audited yet for this version.")}
              </p>
              <div className="mt-3.5 flex flex-col gap-2">
                {(isOwner || isAdminUser) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={handleStartAudit}
                    disabled={startAuditMutation.isPending}
                  >
                    {versionAudit
                      ? t("skillDetail.startNewAudit", "Start new audit")
                      : t("skillDetail.startAuditing", "Start Auditing")}
                  </Button>
                )}
                <Link
                  to={`/skills/${encodeURIComponent(skill.name || skill.guid)}/audits${skill.version ? `?version=${encodeURIComponent(skill.version)}` : ""}`}
                  className="inline-flex items-center gap-1 self-start py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-all hover:text-accent-muted hover:gap-2"
                >
                  {t("audit.viewHistory", "View history")} →
                </Link>
              </div>
            </section>

            {/* ── AgentSeal trust score (#253) ── third-party-verifiable
                security signal. Sits next to the Audit card so the two
                trust signals read as siblings; both follow the same tile
                silhouette inside their card. Admins see a Rescan button
                in the card header to manually re-trigger the scan
                (catches false positives, picks up newer AgentSeal rules
                without waiting for a new publish). */}
            <AgentSealTrustBadge
              scan={skill.agentsealScan ?? null}
              skillIdOrName={skill.name || skill.guid}
              version={skill.version}
              canRescan={isAdmin(user)}
              onRescanned={() => refetch()}
            />

            {/* ── Versions card ── */}
            {versionList.length > 0 && (
              <SkillVersionsCard
                currentVersion={skill.version}
                publishedOnSGT={formatDateSGT(skill.createdOn, i18n.language)}
                totalVersions={versionList.length}
                viewingLatest={Boolean(viewingLatest)}
                onBrowseAll={() => setShowVersions(true)}
              />
            )}

            {/* ── Visibility card ── */}
            <SkillVisibilityCard
              isPrivate={skill.isPrivate}
              sharedWithUsersCount={skill.sharedWithUsers.length}
              sharedWithOrgsCount={skill.sharedWithOrgs.length}
              isOwner={isOwner}
              onManagePermissions={() => setShowPermissionsModal(true)}
            />

            {/* ── Advanced options ── click-to-open card. Settings UI
                lives in `AdvancedOptionsModal` (settings-page-style:
                left nav of categories, right pane of selected
                category's content). */}
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowAdvancedModal(true)}
                className="card-letterpress flex w-full cursor-pointer items-center justify-between gap-2 rounded border border-subtle bg-card p-5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta hover:border-strong-edge hover:text-strong"
              >
                <span className="flex items-center gap-2">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v6m0 10v6m11-11h-6m-10 0H1m17.66-7.66l-4.24 4.24M6.34 17.66l-4.24 4.24m15.56 0l-4.24-4.24M6.34 6.34L2.1 2.1" />
                  </svg>
                  {t("skillDetail.cardAdvanced", "Advanced options")}
                </span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}

            {/* ── Metadata card ── identity + tags + source. Filler-
                with-purpose: makes the right rail visually full
                without resorting to an invisible spacer. */}
            <section className="rounded-md border border-subtle bg-card p-5 card-impression">
              <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
                {t("skillDetail.cardMetadata", "Metadata")}
              </h3>

              <dl className="space-y-2.5 font-text text-sm text-body">
                {(() => {
                  const category =
                    typeof (skill.metadata as { category?: unknown })?.category === "string"
                      ? ((skill.metadata as { category: string }).category)
                      : null;
                  return category ? (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                        {t("skillDetail.metaCategory", "Category")}
                      </dt>
                      <dd className="text-right font-mono text-xs text-strong">{category}</dd>
                    </div>
                  ) : null;
                })()}
                {skill.tags && skill.tags.length > 0 && (
                  <div>
                    <dt className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillDetail.metaTags", "Tags")}
                    </dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-sm border border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-body"
                        >
                          {tag}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {skill.license && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillDetail.metaLicense", "License")}
                    </dt>
                    <dd className="text-right font-mono text-xs text-strong">{skill.license}</dd>
                  </div>
                )}
                {skill.compatibility && (
                  <div>
                    <dt className="mb-1 font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillDetail.metaCompatibility", "Compatibility")}
                    </dt>
                    <dd className="font-mono text-[11px] text-body break-words">
                      {skill.compatibility}
                    </dd>
                  </div>
                )}
                {skill.source && skill.source.type === "github" && (
                  <div>
                    <dt className="mb-1 font-mono text-[10px] uppercase tracking-widest text-meta">
                      {t("skillDetail.metaSource", "Source")}
                    </dt>
                    <dd className="font-mono text-[11px] text-body">
                      <a
                        href={`https://github.com/${skill.source.repo}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-accent transition-colors hover:text-accent-muted"
                      >
                        {skill.source.repo}
                      </a>
                      {skill.source.ref && (
                        <span className="text-meta"> @ {skill.source.ref}</span>
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-meta">
                    {t("skillDetail.metaUpdated", "Updated")}
                  </dt>
                  <dd className="text-right font-mono text-xs text-strong">
                    {formatDateSGT(skill.updatedOn, i18n.language)}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 font-mono text-[10px] uppercase tracking-widest text-meta">
                    {t("skillDetail.metaGuid", "GUID")}
                  </dt>
                  <dd>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          void navigator.clipboard.writeText(skill.guid);
                          addToast({
                            type: "success",
                            message: t("skillDetail.guidCopied", "GUID copied") as string,
                          });
                        }
                      }}
                      className="block w-full truncate rounded-sm border border-subtle bg-elevated px-2 py-1 text-left font-mono text-[11px] text-body transition-colors hover:border-strong-edge hover:text-strong"
                      title={skill.guid}
                    >
                      {skill.guid}
                    </button>
                  </dd>
                </div>
              </dl>
            </section>

            {/* ── Danger zone (owner only) ── */}
            {isOwner && (
              <section className="rounded-md border border-subtle bg-card p-5 card-impression">
                <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-danger/30 pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-danger">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {t("skillDetail.cardDanger", "Danger zone")}
                </h3>
                <p className="mb-3 font-mono text-[11px] leading-relaxed text-meta">
                  {t("skillDetail.transferExplain", "Transfer this skill to another Ornn user. They become the owner; you keep read access only.")}
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  className="mb-4 w-full"
                  onClick={() => setShowTransferModal(true)}
                >
                  {t("skillDetail.transferOwnership", "Transfer ownership")}
                </Button>
                <p className="mb-3 font-mono text-[11px] leading-relaxed text-meta">
                  {t("skillDetail.dangerExplain", "Permanently delete this skill and every version. This cannot be undone.")}
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  {t("skillDetail.deleteSkill", "Delete skill")}
                </Button>
              </section>
            )}

          </aside>
        </main>
      </div>

      {/* ── Save confirmation modal ── */}
      <SkillSaveConfirmModal
        isOpen={showSaveConfirm}
        onClose={() => setShowSaveConfirm(false)}
        skillName={skill.name}
        skipValidation={skipValidation}
        onSkipValidationChange={setSkipValidation}
        onConfirm={() => handleSave(skipValidation)}
        saving={updatePackageMutation.isPending}
      />

      {/* ── All versions browser ── */}
      <SkillVersionsBrowserModal
        isOpen={showVersions}
        onClose={() => setShowVersions(false)}
        versions={versionList}
        currentVersion={skill.version}
        // `latestVersion` is `versionList[0]?.version`; modal only
        // opens when versionList is non-empty so the value is set,
        // but `?? ""` keeps the prop signature simple under
        // noUncheckedIndexedAccess (#450).
        latestVersion={latestVersion ?? ""}
        canManage={canManageVersions}
        auditSummary={auditSummaryByVersion}
        onSelectVersion={handleVersionChange}
        onToggleDeprecation={handleToggleDeprecation}
        deprecationPending={deprecationMutation.isPending}
        deleteVersionPending={deleteVersionMutation.isPending}
        deleteVersionAsync={(v) => deleteVersionMutation.mutateAsync(v)}
        onOpenDiff={() => setShowVersionDiff(true)}
      />

      {/* ── Version diff modal ── */}
      <VersionDiffModal
        isOpen={showVersionDiff}
        onClose={() => setShowVersionDiff(false)}
        idOrName={skill.guid}
        versions={versionList}
        currentVersion={skill.version}
      />

      {/* ── Delete confirmation modal ── */}
      <SkillDeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        skillName={skill.name}
        onConfirm={handleDeleteConfirm}
        deleting={deleteMutation.isPending}
      />

      {/* ── Permissions editor ── */}
      {isOwner && (
        <PermissionsModal
          isOpen={showPermissionsModal}
          onClose={() => setShowPermissionsModal(false)}
          skill={skill}
        />
      )}

      {/* ── Ownership transfer (danger zone) ── */}
      {isOwner && (
        <TransferOwnershipModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          skill={skill}
        />
      )}

      {/* ── Advanced options popup ── */}
      {isOwner && (
        <AdvancedOptionsModal
          isOpen={showAdvancedModal}
          onClose={() => setShowAdvancedModal(false)}
          skill={skill}
        />
      )}

      {/* ── Audit started modal ── */}
      <SkillAuditStartedModal
        isOpen={showAuditStartedModal}
        onClose={() => setShowAuditStartedModal(false)}
      />

      </div>
    </PageTransition>
  );
}
