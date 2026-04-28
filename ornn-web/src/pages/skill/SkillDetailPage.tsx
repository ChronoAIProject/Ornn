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

import { useState, useCallback, useMemo, useEffect } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import JSZip from "jszip";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { VersionPicker } from "@/components/skill/VersionPicker";
import { DeprecationBanner } from "@/components/skill/DeprecationBanner";
import { GitHubOriginChip } from "@/components/skill/GitHubOriginChip";
import { UsagePullsCard } from "@/components/skill/UsagePullsCard";
import { SkillHeroStrip } from "@/components/skill/SkillHeroStrip";
import { BackLink } from "@/components/layout/BackLink";
import { useRefreshSkillFromSource } from "@/hooks/useSkills";
import { useStartAudit, useAuditSummaryByVersion } from "@/hooks/useAudit";
import { useSkillPulls } from "@/hooks/useAnalytics";
import { SkillVersionList } from "@/components/skill/SkillVersionList";
import { PermissionsModal } from "@/components/skill/PermissionsModal";
import {
  useSkill,
  useDeleteSkill,
  useDeleteSkillVersion,
  useUpdateSkillPackage,
  useSkillVersions,
  useSetVersionDeprecation,
} from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { useCurrentUser, useIsAuthenticated, isAdmin } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { buildFileTreeFromEntries, type FileTreeEntry } from "@/utils/fileTreeBuilder";
import { buildTrySkillPrompt } from "@/lib/buildTrySkillPrompt";
import { useTranslation } from "react-i18next";
import type { FileNode } from "@/components/editor/FileTree";
import type { AuditRecord } from "@/types/audit";

/** Format a date string to exact SGT (Asia/Singapore) timestamp. */
function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Last-7-days ISO range, anchored to "now". */
function rangeLast7d(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function SkillDetailPage() {
  const { idOrName } = useParams<{ idOrName: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((s) => s.addToast);
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const { t } = useTranslation();

  const versionParam = searchParams.get("version") ?? undefined;
  const { data: skill, isLoading, error, refetch } = useSkill(idOrName ?? "", versionParam);
  const { data: versionList = [] } = useSkillVersions(idOrName ?? "");
  const deleteMutation = useDeleteSkill();
  const updatePackageMutation = useUpdateSkillPackage(skill?.guid ?? "");
  const deprecationMutation = useSetVersionDeprecation(idOrName ?? "");
  const deleteVersionMutation = useDeleteSkillVersion(idOrName ?? "");
  const { data: auditSummaryByVersion } = useAuditSummaryByVersion(idOrName);
  const refreshMutation = useRefreshSkillFromSource(idOrName ?? "");
  const startAuditMutation = useStartAudit();

  // 7-day pulls totals — feeds the hero "↓ N pulls · 7d" status pill.
  const last7d = useMemo(rangeLast7d, []);
  const { data: pulls7d = [] } = useSkillPulls(skill?.name || skill?.guid, {
    bucket: "day",
    from: last7d.from,
    to: last7d.to,
    version: skill?.version,
  });
  const pullCount7d = useMemo(
    () => pulls7d.reduce((acc, p) => acc + p.total, 0),
    [pulls7d],
  );

  const {
    files: packageFiles,
    fileContents: packageContents,
    rawZip,
    isLoading: packageLoading,
    error: packageError,
  } = useSkillPackage(skill?.presignedPackageUrl);

  const isOwner = !!(isAuthenticated && user?.id && skill?.createdBy === user.id);
  const isAdminUser = isAdmin(user);
  const canManageVersions = isOwner || isAdminUser;
  const canTryWithCli = !!skill && (!skill.isPrivate || isOwner);

  const latestVersion = versionList[0]?.version;
  const viewingLatest = !versionParam || (latestVersion && versionParam === latestVersion);

  const handleVersionChange = useCallback(
    (versionOrLatest: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (versionOrLatest === null) {
        next.delete("version");
      } else {
        next.set("version", versionOrLatest);
      }
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const handleToggleDeprecation = useCallback(
    async ({
      version,
      isDeprecated,
      deprecationNote,
    }: {
      version: string;
      isDeprecated: boolean;
      deprecationNote?: string;
    }) => {
      try {
        await deprecationMutation.mutateAsync({ version, isDeprecated, deprecationNote });
        addToast({ type: "success", message: t("skillDetail.deprecationUpdated") });
      } catch (err) {
        const message = err instanceof Error ? err.message : t("skillDetail.deprecationFailed");
        addToast({ type: "error", message });
      }
    },
    [deprecationMutation, addToast, t],
  );

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showAuditStartedModal, setShowAuditStartedModal] = useState(false);
  const [editedContents, setEditedContents] = useState<Map<string, string>>(new Map());
  const [addedPaths, setAddedPaths] = useState<FileTreeEntry[]>([]);
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set());
  const [skipValidation, setSkipValidation] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const hasChanges = editedContents.size > 0 || addedPaths.length > 0 || deletedPaths.size > 0;

  // Reset version expansion when skill changes.
  useEffect(() => { setShowVersions(false); }, [skill?.guid]);

  const handleContentChange = useCallback((fileId: string, content: string) => {
    setEditedContents((prev) => {
      const next = new Map(prev);
      if (packageContents.get(fileId) === content && !addedPaths.some((e) => e.path === fileId)) {
        next.delete(fileId);
      } else {
        next.set(fileId, content);
      }
      return next;
    });
  }, [packageContents, addedPaths]);

  const handleCreateFile = useCallback((parentId: string | null, name: string) => {
    const path = parentId ? `${parentId}/${name}` : name;
    setAddedPaths((prev) => [...prev, { path, type: "file", viewable: true, size: 0 }]);
    setEditedContents((prev) => new Map(prev).set(path, ""));
  }, []);

  const handleCreateFolder = useCallback((parentId: string | null, name: string) => {
    const path = parentId ? `${parentId}/${name}` : name;
    setAddedPaths((prev) => [...prev, { path, type: "folder", viewable: false, size: 0 }]);
  }, []);

  const handleDeleteFile = useCallback((fileId: string) => {
    const prefix = fileId + "/";
    const isAdded = addedPaths.some((e) => e.path === fileId || e.path.startsWith(prefix));

    if (isAdded) {
      setAddedPaths((prev) => prev.filter((e) => e.path !== fileId && !e.path.startsWith(prefix)));
      setEditedContents((prev) => {
        const next = new Map(prev);
        for (const key of next.keys()) {
          if (key === fileId || key.startsWith(prefix)) next.delete(key);
        }
        return next;
      });
    } else {
      setDeletedPaths((prev) => {
        const next = new Set(prev);
        next.add(fileId);
        for (const key of packageContents.keys()) {
          if (key.startsWith(prefix)) next.add(key);
        }
        return next;
      });
      setEditedContents((prev) => {
        const next = new Map(prev);
        for (const key of next.keys()) {
          if (key === fileId || key.startsWith(prefix)) next.delete(key);
        }
        return next;
      });
    }
  }, [addedPaths, packageContents]);

  const mergedContents = useMemo(() => {
    const merged = new Map(packageContents);
    for (const path of deletedPaths) merged.delete(path);
    for (const [path, content] of editedContents) merged.set(path, content);
    return merged;
  }, [packageContents, editedContents, deletedPaths]);

  const mergedFiles = useMemo(() => {
    if (addedPaths.length === 0 && deletedPaths.size === 0) return packageFiles;
    const entries: FileTreeEntry[] = [];
    function collectEntries(nodes: FileNode[]) {
      for (const node of nodes) {
        if (deletedPaths.has(node.id)) continue;
        entries.push({
          path: node.id,
          type: node.type,
          viewable: node.type === "file",
          size: 0,
        });
        if (node.children) collectEntries(node.children);
      }
    }
    collectEntries(packageFiles);
    for (const entry of addedPaths) entries.push(entry);
    return buildFileTreeFromEntries(entries);
  }, [packageFiles, addedPaths, deletedPaths]);

  const handleSave = async (skip: boolean) => {
    if (!skill) return;
    setShowSaveConfirm(false);
    try {
      const newZip = new JSZip();
      if (rawZip) {
        for (const [path, entry] of Object.entries(rawZip.files)) {
          if (entry.dir) continue;
          if (deletedPaths.has(path)) continue;
          if (editedContents.has(path)) {
            newZip.file(path, editedContents.get(path)!);
          } else {
            const data = await entry.async("uint8array");
            newZip.file(path, data);
          }
        }
      }
      for (const entry of addedPaths) {
        if (entry.type === "file" && editedContents.has(entry.path)) {
          newZip.file(entry.path, editedContents.get(entry.path)!);
        }
      }
      const blob = await newZip.generateAsync({ type: "blob" });
      const zipFile = new File([blob], `${skill.name}.zip`, { type: "application/zip" });
      await updatePackageMutation.mutateAsync({ zipFile, skipValidation: skip });
      addToast({ type: "success", message: t("skillDetail.updateSuccess") });
      setEditedContents(new Map());
      setAddedPaths([]);
      setDeletedPaths(new Set());
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("skillDetail.saveFailed");
      addToast({ type: "error", message });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!skill) return;
    try {
      await deleteMutation.mutateAsync(skill.guid);
      addToast({ type: "success", message: t("skillDetail.deleteSuccess") });
      navigate("/registry");
    } catch {
      addToast({ type: "error", message: t("skillDetail.deleteFailed") });
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleCopyTryPrompt = async () => {
    if (!skill) return;
    const prompt = buildTrySkillPrompt({
      guid: skill.guid,
      name: skill.name,
      description: skill.description,
      metadata: skill.metadata ?? {},
      ornnOrigin: window.location.origin,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      addToast({ type: "success", message: t("skillDetail.cliPromptCopied") });
    } catch {
      addToast({ type: "error", message: t("skillDetail.cliCopyFailed") });
    }
  };

  const handleDownloadPackage = useCallback(async () => {
    if (!skill || !rawZip) return;
    const blob = await rawZip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.name}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [skill, rawZip]);

  const handleStartAudit = useCallback(() => {
    if (!skill) return;
    setShowAuditStartedModal(true);
    startAuditMutation.mutate(
      { idOrName: skill.name || skill.guid, force: true },
      {
        onSuccess: (record) => {
          addToast({
            type: "success",
            message: t(
              "skillDetail.auditDone",
              "Audit complete — verdict {{v}}, score {{s}}/10",
              { v: record.verdict, s: record.overallScore.toFixed(1) },
            ),
          });
        },
        onError: (err) => {
          addToast({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [skill, startAuditMutation, addToast, t]);

  if (isLoading) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center">
          <Skeleton lines={10} />
        </div>
      </PageTransition>
    );
  }

  if (error || !skill) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <h2 className="mb-2 font-display text-2xl text-danger">{t("skillDetail.notFound")}</h2>
            <p className="text-meta">{t("skillDetail.notFoundDesc")}</p>
            <Button onClick={() => navigate("/registry")} className="mt-6">
              {t("skillDetail.backToExplore")}
            </Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  const versionAudit = auditSummaryByVersion?.[skill.version];
  const ownerDisplayName =
    isOwner && user?.displayName
      ? user.displayName
      : skill.createdByDisplayName || skill.createdByEmail || skill.createdBy;
  const ownerAvatarUrl = isOwner ? user?.avatarUrl : null;

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
            onRefresh={() => refreshMutation.mutate(skill.guid)}
          />
        )}

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
          canTryWithCli={canTryWithCli}
          onCopyCliPrompt={handleCopyTryPrompt}
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
            <div className={`flex shrink-0 items-center justify-between gap-3 rounded-sm border px-4 py-2 font-reading text-xs ${tone}`}>
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
        <main className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">

          {/* Left: tabs + content */}
          <section className="flex min-h-[640px] flex-col overflow-hidden rounded-md border border-subtle bg-card shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]">
            <div className="flex shrink-0 border-b border-subtle px-3" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected="true"
                className="-mb-px border-b-2 border-accent px-4 py-3.5 font-mono text-[11px] uppercase tracking-widest text-strong"
              >
                {t("skillDetail.tabContent", "Skill content")}
              </button>
              <Link
                to={`/skills/${encodeURIComponent(skill.name || skill.guid)}/audits${skill.version ? `?version=${encodeURIComponent(skill.version)}` : ""}`}
                role="tab"
                aria-selected="false"
                className="-mb-px border-b-2 border-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-widest text-meta transition-colors hover:text-strong"
              >
                {t("skillDetail.tabAuditHistory", "Audit history")}
              </Link>
            </div>

            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-subtle bg-elevated px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-meta">
                  {t("skillDetail.version", "Version")}
                </span>
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
                <p className="py-12 text-center font-reading text-sm text-meta">
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
                <p className="py-12 text-center font-reading text-sm text-meta">
                  {t("skillDetail.noPackage")}
                </p>
              )}
            </div>
          </section>

          {/* Right rail */}
          <aside className="flex flex-col gap-4">

            {/* ── Audit card ── */}
            <section className="rounded-md border border-subtle bg-card p-5 shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]">
              <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                {t("skillDetail.cardAudit", "Audit")}
              </h3>
              <AuditVerdictPill audit={versionAudit} />
              <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
                {versionAudit?.completedAt ? (
                  <>
                    {t("skillDetail.auditLast", "Last audited {{date}}", { date: formatDateSGT(versionAudit.completedAt) })}
                  </>
                ) : (
                  t("skillDetail.auditNoneYet", "Not audited yet for this version.")
                )}
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

            {/* ── Visibility card ── */}
            <section className="rounded-md border border-subtle bg-card p-5 shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]">
              <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" />
                  <path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z" />
                </svg>
                {t("skillDetail.cardVisibility", "Visibility")}
              </h3>
              <span className={`mb-3 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${skill.isPrivate ? "border-info/40 bg-info-soft text-info" : "border-info/40 bg-info-soft text-info"}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {skill.isPrivate
                    ? <path d="M12 2a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V7a5 5 0 0 0-5-5z" />
                    : <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /></>}
                </svg>
                {skill.isPrivate ? t("common.private", "Private") : t("common.public", "Public")}
              </span>
              <ul className="space-y-1.5 font-reading text-sm text-body">
                <li className="flex items-baseline gap-2.5">
                  <span className="min-w-[18px] text-right font-mono text-sm font-semibold text-strong">
                    {skill.sharedWithUsers.length}
                  </span>
                  <span className="text-xs text-meta">{t("skillDetail.shareUsers", "users")}</span>
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="min-w-[18px] text-right font-mono text-sm font-semibold text-strong">
                    {skill.sharedWithOrgs.length}
                  </span>
                  <span className="text-xs text-meta">{t("skillDetail.shareOrgs", "organizations")}</span>
                </li>
              </ul>
              {isOwner && (
                <div className="mt-3.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowPermissionsModal(true)}
                  >
                    {t("skillDetail.managePermissions", "Manage permissions")}
                  </Button>
                </div>
              )}
            </section>

            {/* ── Versions card ── */}
            {versionList.length > 0 && (
              <section className="rounded-md border border-subtle bg-card p-5 shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]">
                <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  {t("skillDetail.cardVersions", "Versions")}
                </h3>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold tracking-tight text-strong">
                    {skill.version}
                  </span>
                  {viewingLatest && (
                    <span className="rounded-sm border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                      {t("skillDetail.latest", "latest")}
                    </span>
                  )}
                </div>
                <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
                  {t("skillDetail.heroPublishedOn", "Published {{date}}", { date: formatDateSGT(skill.createdOn) })}
                  {versionList.length > 1 && (
                    <>
                      {" · "}
                      {t("skillDetail.versionsTotal", "{{n}} versions total", { n: versionList.length })}
                    </>
                  )}
                </p>
                <div className="mt-3.5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setShowVersions((v) => !v)}
                    className="inline-flex items-center gap-1 self-start py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-all hover:text-accent-muted hover:gap-2"
                  >
                    {showVersions
                      ? t("skillDetail.hideVersions", "Hide all versions")
                      : t("skillDetail.browseVersions", "Browse all versions")}{" "}
                    →
                  </button>
                </div>
                {showVersions && (
                  <div className="mt-3 border-t border-dashed border-subtle pt-3">
                    <SkillVersionList
                      versions={versionList}
                      currentVersion={skill.version}
                      onSelect={(v) => handleVersionChange(v === latestVersion ? null : v)}
                      canManage={canManageVersions}
                      onToggleDeprecation={handleToggleDeprecation}
                      isMutating={deprecationMutation.isPending}
                      isDeleting={deleteVersionMutation.isPending}
                      auditSummary={auditSummaryByVersion}
                      onDeleteVersion={async (version) => {
                        try {
                          await deleteVersionMutation.mutateAsync(version);
                          if (skill.version === version) handleVersionChange(null);
                          addToast({
                            type: "success",
                            message: t("skillDetail.versionDeleted", "Version v{{version}} deleted", { version }),
                          });
                        } catch (err) {
                          addToast({
                            type: "error",
                            message:
                              err instanceof Error
                                ? err.message
                                : t("skillDetail.versionDeleteFailed", "Failed to delete version"),
                          });
                        }
                      }}
                    />
                  </div>
                )}
              </section>
            )}

            {/* ── Danger zone (owner only) ── */}
            {isOwner && (
              <section className="rounded-md border border-subtle bg-card p-5 shadow-[0_2px_8px_-4px_rgba(26,24,18,0.06)] dark:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.45)]">
                <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-danger/30 pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-danger">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {t("skillDetail.cardDanger", "Danger zone")}
                </h3>
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
      <Modal
        isOpen={showSaveConfirm}
        onClose={() => setShowSaveConfirm(false)}
        title={t("skillDetail.saveChanges")}
      >
        <p className="mb-4 font-reading text-sm text-meta">
          {t("skillDetail.saveConfirm", { name: skill.name })}
        </p>
        <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-subtle bg-elevated p-3 select-none">
          <button
            type="button"
            role="switch"
            aria-checked={skipValidation}
            onClick={() => setSkipValidation((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              skipValidation ? "bg-accent" : "bg-elevated"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                skipValidation ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <div>
            <p className="font-reading text-sm text-strong">{t("skillDetail.skipValidation")}</p>
            <p className="font-reading text-xs text-meta">{t("skillDetail.skipDescription")}</p>
          </div>
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setShowSaveConfirm(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={() => handleSave(skipValidation)} loading={updatePackageMutation.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </Modal>

      {/* ── Delete confirmation modal ── */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t("skillDetail.deleteTitle")}
      >
        <p className="font-reading text-sm text-meta">
          {t("skillDetail.deleteConfirm", { name: skill.name }).replace(/<\/?strong>/g, "")}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={handleDeleteConfirm} loading={deleteMutation.isPending}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      {/* ── Permissions editor ── */}
      {isOwner && (
        <PermissionsModal
          isOpen={showPermissionsModal}
          onClose={() => setShowPermissionsModal(false)}
          skill={skill}
        />
      )}

      {/* ── Audit started modal ── */}
      <Modal
        isOpen={showAuditStartedModal}
        onClose={() => setShowAuditStartedModal(false)}
        title={t("skillDetail.auditStartedTitle", "Audit started") as string}
      >
        <p className="font-reading text-sm text-meta">
          {t(
            "skillDetail.auditStartedBody",
            "We're running the audit in the background. It takes around 20-30 seconds — when it's done, a new entry will appear in the Audit history. You can close this dialog and keep working.",
          )}
        </p>
        <div className="mt-6 flex justify-end">
          <Button size="sm" onClick={() => setShowAuditStartedModal(false)}>
            {t("common.gotIt", "Got it")}
          </Button>
        </div>
      </Modal>

      </div>
    </PageTransition>
  );
}

/** Audit verdict tile rendered inside the right-rail Audit card. */
function AuditVerdictPill({ audit }: { audit?: AuditRecord }) {
  const { t } = useTranslation();
  if (!audit || audit.status !== "completed") {
    return (
      <div className="mb-3.5 flex items-center gap-3 rounded-sm border border-strong-edge bg-elevated/60 p-3 font-mono text-[11px] uppercase tracking-wider text-meta">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-strong-edge text-meta" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
        </div>
        <span>{t("skillDetail.auditNone", "Not audited")}</span>
      </div>
    );
  }
  const tone =
    audit.verdict === "green"
      ? "border-success/30 bg-success-soft text-success"
      : audit.verdict === "yellow"
        ? "border-warning/30 bg-warning-soft text-warning"
        : "border-danger/30 bg-danger-soft text-danger";
  const label =
    audit.verdict === "green"
      ? t("skillDetail.auditPassLabel", "Pass · low risk")
      : audit.verdict === "yellow"
        ? t("skillDetail.auditWarnLabel", "Caution")
        : t("skillDetail.auditFailLabel", "Risk");
  return (
    <div className={`mb-3.5 flex items-center gap-3 rounded-sm border p-3 ${tone}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-current text-page" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
      </div>
      <div className="flex flex-col gap-0.5">
        <div>
          <span className="font-display text-2xl font-semibold leading-none">
            {audit.overallScore.toFixed(1)}
          </span>
          <span className="ml-1 font-mono text-[11px] tracking-wide text-meta">/ 10</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{label}</span>
      </div>
    </div>
  );
}
