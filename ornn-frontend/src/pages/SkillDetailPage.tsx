import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { useSkill, useDeleteSkill, useUpdateSkill, useUpdateSkillPackage } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { useCurrentUser } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { buildFileTreeFromEntries, type FileTreeEntry } from "@/utils/fileTreeBuilder";

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
import type { FileNode } from "@/components/editor/FileTree";

export function SkillDetailPage() {
  const { idOrName } = useParams<{ idOrName: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const user = useCurrentUser();
  const { data: skill, isLoading, error, refetch } = useSkill(idOrName ?? "");
  const deleteMutation = useDeleteSkill();
  const updateMutation = useUpdateSkill(skill?.guid ?? "");
  const updatePackageMutation = useUpdateSkillPackage(skill?.guid ?? "");

  const {
    files: packageFiles,
    fileContents: packageContents,
    rawZip,
    isLoading: packageLoading,
    error: packageError,
  } = useSkillPackage(skill?.presignedPackageUrl);

  const isOwner = user?.id && skill?.createdBy === user.id;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
    // If it's a newly added file, just remove it from addedPaths and editedContents
    if (addedPaths.some((e) => e.path === fileId)) {
      setAddedPaths((prev) => prev.filter((e) => e.path !== fileId));
      setEditedContents((prev) => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });
    } else {
      // Mark existing file for deletion
      setDeletedPaths((prev) => new Set(prev).add(fileId));
      setEditedContents((prev) => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, [addedPaths]);

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

  const handleSave = async () => {
    if (!skill) return;
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
      await updatePackageMutation.mutateAsync({ zipFile, skipValidation });
      addToast({ type: "success", message: "Skill updated" });
      setEditedContents(new Map());
      setAddedPaths([]);
      setDeletedPaths(new Set());
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save package";
      addToast({ type: "error", message });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!skill) return;
    try {
      await deleteMutation.mutateAsync(skill.guid);
      addToast({ type: "success", message: "Skill deleted" });
      navigate("/");
    } catch {
      addToast({ type: "error", message: "Failed to delete skill" });
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleToggleVisibility = async () => {
    if (!skill) return;
    try {
      await updateMutation.mutateAsync({ isPrivate: !skill.isPrivate });
      addToast({
        type: "success",
        message: skill.isPrivate ? "Skill is now public" : "Skill is now private",
      });
      refetch();
    } catch {
      addToast({ type: "error", message: "Failed to update visibility" });
    }
  };

  if (isLoading) {
    return (
      <PageTransition>
        <div className="h-full overflow-y-auto py-4">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <Card><Skeleton lines={10} /></Card>
          <Card><Skeleton lines={8} /></Card>
        </div>
        </div>
      </PageTransition>
    );
  }

  if (error || !skill) {
    return (
      <PageTransition>
        <div className="h-full overflow-y-auto py-4">
        <div className="py-20 text-center">
          <h2 className="mb-2 font-heading text-2xl text-neon-red">Skill Not Found</h2>
          <p className="text-text-muted">The skill you are looking for does not exist.</p>
          <Button onClick={() => navigate("/")} className="mt-6">Back to Explore</Button>
        </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      {/* Header: fixed layout with title/description on left, buttons on right */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="neon-cyan font-heading text-2xl font-bold tracking-wider text-neon-cyan sm:text-3xl truncate">
            {skill.name}
          </h1>
          <p className="mt-1 font-body text-text-muted line-clamp-2">{skill.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/playground?skill=${encodeURIComponent(skill.name)}`)}
          >
            Try in Playground
          </Button>
          {/* Toggle visibility (owner only) */}
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleToggleVisibility}
              loading={updateMutation.isPending}
            >
              {skill.isPrivate ? "Make Public" : "Make Private"}
            </Button>
          )}

          {/* Owner actions */}
          {isOwner && (
            <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
        {/* Main content — Package Contents */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-heading text-sm uppercase tracking-wider text-neon-cyan">
              Package Contents
            </h3>
            {isOwner && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="font-body text-xs text-text-muted">Skip validation</span>
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
                </label>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasChanges}
                  loading={updatePackageMutation.isPending}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
          {packageLoading ? (
            <Skeleton lines={8} />
          ) : packageError ? (
            <p className="py-8 text-center font-body text-sm text-text-muted">
              Failed to load package contents.
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
            />
          ) : (
            <p className="py-8 text-center font-body text-sm text-text-muted">
              No package contents available.
            </p>
          )}
        </Card>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <h3 className="mb-4 font-heading text-sm uppercase tracking-wider text-neon-cyan">
              Details
            </h3>
            <div className="space-y-3 font-body text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Author</span>
                <div className="flex items-center gap-2">
                  {isOwner && user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-[10px] text-text-muted">
                      {(isOwner && user?.displayName ? user.displayName : skill.createdBy).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-text-primary">
                    {isOwner && user?.displayName ? user.displayName : skill.createdBy}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Created</span>
                <span className="text-text-primary">{formatDateSGT(skill.createdOn)}</span>
              </div>
              {skill.updatedOn && (
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Updated</span>
                  <span className="text-text-primary">{formatDateSGT(skill.updatedOn)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Visibility</span>
                <Badge color={skill.isPrivate ? "cyan" : "green"}>
                  {skill.isPrivate ? "Private" : "Public"}
                </Badge>
              </div>
            </div>
          </Card>

          {skill.tags.length > 0 && (
            <Card>
              <h3 className="mb-4 font-heading text-sm uppercase tracking-wider text-neon-cyan">
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {skill.tags.map((tag) => (
                  <Badge key={tag} color="cyan">{tag}</Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Skill"
      >
        <p className="font-body text-sm text-text-muted">
          Are you sure you want to delete <span className="text-text-primary font-semibold">{skill.name}</span>? This action cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleDeleteConfirm} loading={deleteMutation.isPending}>
            Delete
          </Button>
        </div>
      </Modal>
      </div>
    </PageTransition>
  );
}
