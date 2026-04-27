import { useState, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import JSZip from "jszip";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { VersionPicker } from "@/components/skill/VersionPicker";
import { DeprecationBanner } from "@/components/skill/DeprecationBanner";
import { GitHubOriginChip } from "@/components/skill/GitHubOriginChip";
import { AnalyticsCard } from "@/components/skill/AnalyticsCard";
import { AuditHistoryCard } from "@/components/skill/AuditHistoryCard";
import { BackLink } from "@/components/layout/BackLink";
import { useRefreshSkillFromSource } from "@/hooks/useSkills";
import { useStartAudit, useAuditSummaryByVersion } from "@/hooks/useAudit";
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

/** Format a date string to exact SGT (Asia/Singapore) timestamp */
function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
import { useTranslation } from "react-i18next";
import type { FileNode } from "@/components/editor/FileTree";

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

  const {
    files: packageFiles,
    fileContents: packageContents,
    rawZip,
    isLoading: packageLoading,
    error: packageError,
  } = useSkillPackage(skill?.presignedPackageUrl);

  const isOwner = isAuthenticated && user?.id && skill?.createdBy === user.id;
  const isAdminUser = isAdmin(user);
  const canManageVersions = !!(isOwner || isAdminUser);
  const canTryWithCli = !!skill && (!skill.isPrivate || !!isOwner);

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
  const hasChanges = editedContents.size > 0 || addedPaths.length > 0 || deletedPaths.size > 0;

  const handleContentChange = useCallback((fileId: string, content: string) => {
    setEditedContents((prev) => {
      const next = new Map(prev);
      // If content matches original and isn't a new file, remove from edits
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
      // Remove the item and all children from addedPaths and editedContents
      setAddedPaths((prev) => prev.filter((e) => e.path !== fileId && !e.path.startsWith(prefix)));
      setEditedContents((prev) => {
        const next = new Map(prev);
        for (const key of next.keys()) {
          if (key === fileId || key.startsWith(prefix)) next.delete(key);
        }
        return next;
      });
    } else {
      // Mark existing file/folder and all children for deletion
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
    for (const path of deletedPaths) {
      merged.delete(path);
    }
    for (const [path, content] of editedContents) {
      merged.set(path, content);
    }
    return merged;
  }, [packageContents, editedContents, deletedPaths]);

  /** Build merged file tree: original files - deleted + added */
  const mergedFiles = useMemo(() => {
    if (addedPaths.length === 0 && deletedPaths.size === 0) return packageFiles;

    // Collect all entries from existing file tree
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

    // Add new entries
    for (const entry of addedPaths) {
      entries.push(entry);
    }

    return buildFileTreeFromEntries(entries);
  }, [packageFiles, addedPaths, deletedPaths]);

  const handleSave = async (skip: boolean) => {
    if (!skill) return;
    setShowSaveConfirm(false);
    try {
      const newZip = new JSZip();

      // Copy original files (skip deleted)
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

      // Add new files (not in original ZIP)
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

  if (isLoading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <Skeleton lines={10} />
        </div>
      </PageTransition>
    );
  }

  if (error || !skill) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <h2 className="mb-2 font-heading text-2xl text-neon-red">{t("skillDetail.notFound")}</h2>
            <p className="text-text-muted">{t("skillDetail.notFoundDesc")}</p>
            <Button onClick={() => navigate("/registry")} className="mt-6">{t("skillDetail.backToExplore")}</Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      <nav className="mb-2 shrink-0">
        <BackLink label={t("common.back", "Back")} />
      </nav>
      {skill.isDeprecated && (
        <DeprecationBanner
          className="mb-3 shrink-0"
          version={skill.version}
          note={skill.deprecationNote}
          hasNewerVersion={!viewingLatest && !!latestVersion}
          latestVersion={latestVersion}
          onViewLatest={() => handleVersionChange(null)}
        />
      )}
      {skill.source && (
        <GitHubOriginChip
          className="mb-3 shrink-0"
          source={skill.source}
          canRefresh={!!(isOwner || isAdminUser)}
          isRefreshing={refreshMutation.isPending}
          onRefresh={() => refreshMutation.mutate(skill.guid)}
        />
      )}
      {(() => {
        // Version-context audit banner: green is silent; yellow/red/missing
        // surface a one-line cautionary note pointing at the audit history.
        const v = auditSummaryByVersion?.[skill.version];
        if (v && v.verdict === "green") return null;
        const tone =
          !v
            ? "neutral"
            : v.verdict === "red"
              ? "red"
              : "yellow";
        const ringCls =
          tone === "neutral"
            ? "border-text-muted/30 bg-bg-elevated/40 text-text-muted"
            : tone === "red"
              ? "border-neon-red/30 bg-neon-red/5 text-neon-red"
              : "border-neon-yellow/30 bg-neon-yellow/5 text-neon-yellow";
        const message = !v
          ? t(
              "skillDetail.auditBannerNotAudited",
              "v{{v}} has not been audited yet. Owners share with permission gates that read this audit.",
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
          <div
            className={`mb-3 shrink-0 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 font-body text-xs ${ringCls}`}
          >
            <span className="min-w-0 truncate">{message}</span>
            <Link
              to={`/skills/${encodeURIComponent(skill.name || skill.guid)}/audits?version=${encodeURIComponent(skill.version)}`}
              className="shrink-0 rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:opacity-80"
            >
              {t("audit.viewHistory", "View history")}
            </Link>
          </div>
        );
      })()}

      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* Main content — Package Contents (fills available height) */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <div className="mb-3 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <h3 className="font-heading text-sm uppercase tracking-wider text-neon-cyan truncate">
                {t("skillDetail.packageContents")}
              </h3>
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
              <Skeleton lines={8} />
            ) : packageError ? (
              <p className="py-8 text-center font-body text-sm text-text-muted">
                {t("skillDetail.failedPackage")}
              </p>
            ) : (packageFiles.length > 0 || addedPaths.length > 0) ? (
              <SkillPackagePreview
                files={mergedFiles}
                fileContents={mergedContents}
                metadata={null}
                editable={!!isOwner}
                onContentChange={handleContentChange}
                onCreateFile={isOwner ? handleCreateFile : undefined}
                onCreateFolder={isOwner ? handleCreateFolder : undefined}
                onFileDelete={isOwner ? handleDeleteFile : undefined}
                className="h-full"
              />
            ) : (
              <p className="py-8 text-center font-body text-sm text-text-muted">
                {t("skillDetail.noPackage")}
              </p>
            )}
          </div>
        </Card>

        {/* Sidebar — unified panel */}
        <div className="flex flex-col min-h-0 overflow-y-auto gap-4">
          {/* Info card */}
          <div className="glass rounded-xl p-5 space-y-5">
            {/* Description */}
            <div>
              <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">{t("skillDetail.description")}</p>
              <p className="font-body text-sm text-text-primary leading-relaxed">
                {skill.description}
              </p>
            </div>

            {/* Tags */}
            {skill.tags.length > 0 && (
              <div>
                <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">{t("skillDetail.tags")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {skill.tags.map((tag) => (
                    <Badge key={tag} color="cyan">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Author */}
            <div>
              <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">{t("skillDetail.author")}</p>
              <div className="flex items-center gap-2.5">
                {isOwner && user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-elevated text-[10px] text-text-muted ring-1 ring-neon-cyan/20">
                    {(isOwner && user?.displayName ? user.displayName : skill.createdByDisplayName || skill.createdByEmail || skill.createdBy).charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="font-body text-sm text-text-primary truncate">
                  {isOwner && user?.displayName ? user.displayName : skill.createdByDisplayName || skill.createdByEmail || skill.createdBy}
                </span>
              </div>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">{t("skillDetail.created")}</p>
                <p className="font-body text-xs text-text-primary">{formatDateSGT(skill.createdOn)}</p>
              </div>
              {skill.updatedOn && (
                <div>
                  <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">{t("skillDetail.updated")}</p>
                  <p className="font-body text-xs text-text-primary">{formatDateSGT(skill.updatedOn)}</p>
                </div>
              )}
              <div>
                <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">{t("skillDetail.visibility")}</p>
                <Badge color={skill.isPrivate ? "cyan" : "green"}>
                  {skill.isPrivate ? t("common.private") : t("common.public")}
                </Badge>
                {skill.isPrivate && (skill.sharedWithUsers.length > 0 || skill.sharedWithOrgs.length > 0) && (
                  <p className="font-body text-[11px] text-text-muted mt-1">
                    {t("skillDetail.sharedWithSummary", {
                      defaultValue: "Shared with {{users}} users, {{orgs}} orgs",
                      users: skill.sharedWithUsers.length,
                      orgs: skill.sharedWithOrgs.length,
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Actions — only for authenticated users */}
            {isAuthenticated && (
              <>
                <div className="border-t border-neon-cyan/10" />
                <div className="space-y-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/playground?skill=${encodeURIComponent(skill.name)}`)}
                  >
                    {t("skillDetail.tryPlayground")}
                  </Button>
                  {canTryWithCli && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={handleCopyTryPrompt}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        {t("skillDetail.tryWithCli")}
                      </span>
                    </Button>
                  )}
                  {rawZip && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        const blob = await rawZip.generateAsync({ type: "blob" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${skill.name}.zip`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {t("skillDetail.downloadSkill")}
                      </span>
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowPermissionsModal(true)}
                    >
                      {t("skillDetail.managePermissions", "Manage permissions")}
                    </Button>
                  )}
                  {(isOwner || isAdminUser) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => {
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
                                  {
                                    v: record.verdict,
                                    s: record.overallScore.toFixed(1),
                                  },
                                ),
                              });
                            },
                            onError: (err) => {
                              addToast({
                                type: "error",
                                message:
                                  err instanceof Error ? err.message : String(err),
                              });
                            },
                          },
                        );
                      }}
                      disabled={startAuditMutation.isPending}
                    >
                      {t("skillDetail.startAuditing", "Start Auditing")}
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      variant="danger"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {t("common.delete")}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {versionList.length > 0 && (
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
                  // If the user was viewing the now-deleted version, snap
                  // back to latest so the page doesn't 404.
                  if (skill.version === version) {
                    handleVersionChange(null);
                  }
                  addToast({
                    type: "success",
                    message: t(
                      "skillDetail.versionDeleted",
                      "Version v{{version}} deleted",
                      { version },
                    ),
                  });
                } catch (err) {
                  addToast({
                    type: "error",
                    message:
                      err instanceof Error
                        ? err.message
                        : t(
                            "skillDetail.versionDeleteFailed",
                            "Failed to delete version",
                          ),
                  });
                }
              }}
            />
          )}

          <AnalyticsCard idOrName={skill.name || skill.guid} version={skill.version} />

          <AuditHistoryCard
            idOrName={skill.name || skill.guid}
            version={skill.version}
          />
        </div>
      </div>

      {/* Save confirmation modal */}
      <Modal
        isOpen={showSaveConfirm}
        onClose={() => setShowSaveConfirm(false)}
        title={t("skillDetail.saveChanges")}
      >
        <p className="font-body text-sm text-text-muted mb-4">
          {t("skillDetail.saveConfirm", { name: skill.name })}
        </p>
        <label className="flex items-center gap-3 cursor-pointer select-none glass rounded-lg p-3 border border-neon-cyan/10">
          <button
            type="button"
            role="switch"
            aria-checked={skipValidation}
            onClick={() => setSkipValidation((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              skipValidation ? "bg-neon-cyan" : "bg-bg-elevated"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                skipValidation ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <div>
            <p className="font-body text-sm text-text-primary">{t("skillDetail.skipValidation")}</p>
            <p className="font-body text-xs text-text-muted">{t("skillDetail.skipDescription")}</p>
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

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t("skillDetail.deleteTitle")}
      >
        <p className="font-body text-sm text-text-muted">
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

      {/* Permissions editor — only for the author (and platform admins
          via the same gate). Backend re-checks on save. */}
      {isOwner && (
        <PermissionsModal
          isOpen={showPermissionsModal}
          onClose={() => setShowPermissionsModal(false)}
          skill={skill}
        />
      )}

      {/* Start Auditing — fire-and-forget popup. The mutation runs in the
          background; user closes the popup and finds the new row in
          Audit history when it lands. */}
      <Modal
        isOpen={showAuditStartedModal}
        onClose={() => setShowAuditStartedModal(false)}
        title={t("skillDetail.auditStartedTitle", "Audit started") as string}
      >
        <p className="font-body text-sm text-text-muted">
          {t(
            "skillDetail.auditStartedBody",
            "We're running the audit in the background. It takes around 20–30 seconds — when it's done, a new entry will appear in the Audit history card below. You can close this dialog and keep working.",
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
