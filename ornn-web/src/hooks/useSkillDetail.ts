/**
 * useSkillDetail — page-level state hook for SkillDetailPage (#453).
 *
 * Pulls all the queries, mutations, derived state, refs, and handlers
 * out of the page so the page file is left with just the layout shell
 * and prop wiring. The hook owns:
 *
 * - **Queries**: skill, versions, audit summary, audit history, pulls (7d),
 *   package (files / contents / raw zip).
 * - **Mutations**: delete skill, delete version, update package,
 *   deprecation toggle, refresh-from-source, start audit.
 * - **Derived state**: isOwner, isAdmin, canManageVersions, latestVersion,
 *   viewingLatest, pullCount7d, mergedContents, mergedFiles,
 *   versionAudit, versionAuditRunning, ownerDisplayName, ownerAvatarUrl,
 *   hasChanges.
 * - **Local UI state**: showDeleteConfirm / showPermissionsModal /
 *   showAdvancedModal / showSaveConfirm / showAuditStartedModal /
 *   showVersions / showVersionDiff (all modals + the in-page diff toggle),
 *   editedContents / addedPaths / deletedPaths / skipValidation.
 * - **Handlers**: handleVersionChange, handleToggleDeprecation,
 *   handleContentChange / handleCreateFile / handleCreateFolder /
 *   handleDeleteFile (file-tree editing), handleSave, handleDeleteConfirm,
 *   handleDownloadPackage, handleStartAudit.
 *
 * Side-effect: resets the version-browser + diff toggles when the skill
 * id flips so navigating between two skills doesn't leak modal state.
 *
 * @module hooks/useSkillDetail
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import JSZip from "jszip";
import {
  useSkill,
  useDeleteSkill,
  useDeleteSkillVersion,
  useUpdateSkillPackage,
  useSkillVersions,
  useSetVersionDeprecation,
  useRefreshSkillFromSource,
} from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { useSourceDriftProbe } from "@/hooks/useSourceDriftProbe";
import {
  useStartAudit,
  useAuditSummaryByVersion,
  useSkillAuditHistory,
} from "@/hooks/useAudit";
import { useSkillPulls } from "@/hooks/useAnalytics";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import { useSkillAccess } from "@/hooks/useSkillAccess";
import { useToastStore } from "@/stores/toastStore";
import { buildFileTreeFromEntries, type FileTreeEntry } from "@/utils/fileTreeBuilder";
import { translateError } from "@/utils/translateError";
import { track } from "@/lib/analytics";
import type { FileNode } from "@/components/editor/FileTree";

/** Last-7-days ISO range, anchored to "now". */
function rangeLast7d(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function useSkillDetail(idOrName: string | undefined) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((s) => s.addToast);
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const { t } = useTranslation();

  const versionParam = searchParams.get("version") ?? undefined;
  const { data: skill, isLoading, error, refetch } = useSkill(idOrName ?? "", versionParam);
  const { data: versionList = [] } = useSkillVersions(idOrName ?? "");
  // Two-id split (#940): wire the GUID (delete route is GUID-only) but
  // pass the cache-key id (idOrName, often a NAME from the URL) so the
  // deleted skill's detail/versions cache is removed before the broad
  // list invalidation can refetch it → 404.
  const deleteMutation = useDeleteSkill(skill?.guid ?? "", idOrName ?? "");
  const updatePackageMutation = useUpdateSkillPackage(skill?.guid ?? "");
  // Two-id split (#750): wire the GUID (version-write routes are GUID-only)
  // but keep the cache-key id (idOrName) for invalidation.
  const deprecationMutation = useSetVersionDeprecation(skill?.guid ?? "", idOrName ?? "");
  const deleteVersionMutation = useDeleteSkillVersion(skill?.guid ?? "", idOrName ?? "");
  const { data: auditSummaryByVersion } = useAuditSummaryByVersion(idOrName);
  // History for the version currently being viewed, so the audit card
  // can detect an in-flight (status: running) audit and show a loading
  // state. The hook polls every 3s while any row is running.
  const { data: versionAuditHistory } = useSkillAuditHistory(idOrName, {
    version: versionParam,
  });
  const refreshMutation = useRefreshSkillFromSource(idOrName ?? "");
  const startAuditMutation = useStartAudit();

  // Lazy on-view drift freshening (#1178) — re-reads the detail once when the
  // github source's last drift check is stale. See useSourceDriftProbe.
  useSourceDriftProbe(skill?.source, refetch);

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

  // Three access tiers (#1127) from the shared hook — `canWrite` is what
  // lets a write-grantee (not just the owner) see the content-edit UI.
  const { isOwner, isAdmin: isAdminUser, canWrite, canManage } = useSkillAccess(skill);
  const canManageVersions = canManage;

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
      deprecationNote?: string | undefined;
    }) => {
      try {
        await deprecationMutation.mutateAsync({ version, isDeprecated, deprecationNote });
        addToast({ type: "success", message: t("skillDetail.deprecationUpdated") });
      } catch (err) {
        const message = translateError(err, t("skillDetail.deprecationFailed"));
        addToast({ type: "error", message });
      }
    },
    [deprecationMutation, addToast, t],
  );

  // ── Modal + file-edit state ─────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showAuditStartedModal, setShowAuditStartedModal] = useState(false);
  const [editedContents, setEditedContents] = useState<Map<string, string>>(new Map());
  const [addedPaths, setAddedPaths] = useState<FileTreeEntry[]>([]);
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set());
  const [skipValidation, setSkipValidation] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showVersionDiff, setShowVersionDiff] = useState(false);
  const hasChanges = editedContents.size > 0 || addedPaths.length > 0 || deletedPaths.size > 0;

  // Reset version expansion when skill changes.
  useEffect(() => {
    setShowVersions(false);
    setShowVersionDiff(false);
  }, [skill?.guid]);

  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      setEditedContents((prev) => {
        const next = new Map(prev);
        if (packageContents.get(fileId) === content && !addedPaths.some((e) => e.path === fileId)) {
          next.delete(fileId);
        } else {
          next.set(fileId, content);
        }
        return next;
      });
    },
    [packageContents, addedPaths],
  );

  const handleCreateFile = useCallback((parentId: string | null, name: string) => {
    const path = parentId ? `${parentId}/${name}` : name;
    setAddedPaths((prev) => [...prev, { path, type: "file", viewable: true, size: 0 }]);
    setEditedContents((prev) => new Map(prev).set(path, ""));
  }, []);

  const handleCreateFolder = useCallback((parentId: string | null, name: string) => {
    const path = parentId ? `${parentId}/${name}` : name;
    setAddedPaths((prev) => [...prev, { path, type: "folder", viewable: false, size: 0 }]);
  }, []);

  const handleDeleteFile = useCallback(
    (fileId: string) => {
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
    },
    [addedPaths, packageContents],
  );

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

  const handleSave = useCallback(
    async (skip: boolean) => {
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
        track("skill.version_published", {
          skillId: skill.guid,
          skipValidation: skip,
        });
        addToast({ type: "success", message: t("skillDetail.updateSuccess") });
        setEditedContents(new Map());
        setAddedPaths([]);
        setDeletedPaths(new Set());
        refetch();
      } catch (err) {
        const message = translateError(err, t("skillDetail.saveFailed"));
        addToast({ type: "error", message });
      }
    },
    [skill, rawZip, deletedPaths, editedContents, addedPaths, updatePackageMutation, addToast, t, refetch],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!skill) return;
    try {
      await deleteMutation.mutateAsync();
      addToast({ type: "success", message: t("skillDetail.deleteSuccess") });
      navigate("/registry");
    } catch {
      addToast({ type: "error", message: t("skillDetail.deleteFailed") });
    } finally {
      setShowDeleteConfirm(false);
    }
  }, [skill, deleteMutation, addToast, t, navigate]);

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
            message: translateError(err),
          });
        },
      },
    );
  }, [skill, startAuditMutation, addToast, t]);

  // Derived once `skill` is loaded — undefined while loading is fine
  // because callers gate on `isLoading`/`error` first.
  const versionAudit = skill ? auditSummaryByVersion?.[skill.version] : undefined;
  const versionAuditRunning =
    versionAuditHistory?.some((r) => r.status === "running") ?? false;
  // #718 — `auditSummaryByVersion` returns the latest *completed*
  // record per version, so a newer failed rerun was invisible on
  // Skill Detail and admins kept seeing the stale prior score as
  // though it were current. `versionAuditHistory` lists every
  // record newest-first; if the most recent entry is `failed`
  // (and newer than the displayed completed audit, when one
  // exists) we surface that explicitly through `AuditVerdictPill`.
  const latestVersionAudit = versionAuditHistory?.[0];
  const versionAuditLatestFailed = Boolean(
    latestVersionAudit &&
    latestVersionAudit.status === "failed" &&
    (!versionAudit ||
      new Date(latestVersionAudit.createdAt).getTime() >
        new Date(versionAudit.completedAt ?? versionAudit.createdAt).getTime()),
  );
  const ownerDisplayName =
    isOwner && user?.displayName
      ? user.displayName
      : skill
        ? skill.createdByDisplayName || skill.createdByEmail || skill.createdBy
        : "";
  const ownerAvatarUrl = isOwner ? user?.avatarUrl ?? null : null;

  return {
    // ── primitives ──
    skill,
    isLoading,
    error,
    refetch,
    versionList,
    versionParam,
    latestVersion,
    viewingLatest,
    pullCount7d,
    packageFiles,
    packageContents,
    rawZip,
    packageLoading,
    packageError,
    user,
    isAuthenticated,
    isOwner,
    isAdminUser,
    canWrite,
    canManageVersions,
    auditSummaryByVersion,
    versionAudit,
    versionAuditRunning,
    versionAuditLatestFailed,
    ownerDisplayName,
    ownerAvatarUrl,
    // ── mutations exposed for the modals' loading states ──
    deleteMutation,
    updatePackageMutation,
    deprecationMutation,
    deleteVersionMutation,
    refreshMutation,
    startAuditMutation,
    // ── modal + edit state ──
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
    editedContents,
    setEditedContents,
    addedPaths,
    setAddedPaths,
    deletedPaths,
    setDeletedPaths,
    hasChanges,
    mergedContents,
    mergedFiles,
    // ── handlers ──
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
  };
}

export type SkillDetailContext = ReturnType<typeof useSkillDetail>;
