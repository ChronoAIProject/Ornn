import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useSkill, useUpdateSkill, useUpdateSkillPackage } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { formatFileSize } from "@/utils/formatters";

export function EditSkillPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { data: skill, isLoading, refetch } = useSkill(id ?? "");
  const updateMutation = useUpdateSkill(id ?? "");
  const updatePackageMutation = useUpdateSkillPackage(id ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);

  const handleToggleVisibility = async () => {
    if (!skill) return;
    try {
      await updateMutation.mutateAsync({ isPrivate: !skill.isPrivate });
      addToast({
        type: "success",
        message: skill.isPrivate ? "Skill is now public" : "Skill is now private",
      });
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update visibility";
      addToast({ type: "error", message });
    }
  };

  const handleUploadPackage = async () => {
    if (!zipFile) return;
    try {
      await updatePackageMutation.mutateAsync({ zipFile });
      addToast({ type: "success", message: "Skill package updated" });
      setZipFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update package";
      addToast({ type: "error", message });
    }
  };

  if (isLoading) {
    return (
      <PageTransition>
        <div className="h-full overflow-y-auto py-4">
        <Card className="mx-auto max-w-2xl"><Skeleton lines={8} /></Card>
        </div>
      </PageTransition>
    );
  }

  if (!skill) {
    return (
      <PageTransition>
        <div className="h-full overflow-y-auto py-4">
        <p className="py-20 text-center text-text-muted">Skill not found</p>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <h1 className="neon-cyan mb-8 font-heading text-2xl font-bold tracking-wider text-neon-cyan sm:text-3xl">
        EDIT: {skill.name}
      </h1>

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Visibility toggle */}
        <Card>
          <h3 className="mb-4 font-heading text-sm uppercase tracking-wider text-neon-cyan">
            Visibility
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-body text-sm text-text-primary">
                Current visibility:{" "}
                <Badge color={skill.isPrivate ? "cyan" : "green"}>
                  {skill.isPrivate ? "Private" : "Public"}
                </Badge>
              </p>
              <p className="mt-1 font-body text-xs text-text-muted">
                {skill.isPrivate
                  ? "Only you can see this skill. Make it public to share with others."
                  : "This skill is visible to everyone. Make it private to hide it."}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleToggleVisibility}
              loading={updateMutation.isPending}
            >
              {skill.isPrivate ? "Make Public" : "Make Private"}
            </Button>
          </div>
        </Card>

        {/* Upload new package */}
        <Card>
          <h3 className="mb-4 font-heading text-sm uppercase tracking-wider text-neon-cyan">
            Update Package
          </h3>
          <p className="mb-4 font-body text-xs text-text-muted">
            Upload a new ZIP package to replace the current skill contents.
            Tags, description, and metadata are extracted from the SKILL.md inside the ZIP.
          </p>

          <div className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neon-cyan/20 bg-bg-deep/50 px-6 py-8 transition-colors hover:border-neon-cyan/40"
            >
              {zipFile ? (
                <div className="text-center">
                  <p className="font-mono text-sm text-neon-cyan">{zipFile.name}</p>
                  <p className="mt-1 text-xs text-text-muted">{formatFileSize(zipFile.size)}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setZipFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="mt-2 text-xs text-neon-red hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <p className="font-body text-sm text-text-muted">
                    Click to select a .zip file
                  </p>
                  <p className="mt-1 text-xs text-text-muted/60">
                    .zip files up to 50 MB
                  </p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setZipFile(f);
              }}
              className="hidden"
            />

            {zipFile && (
              <div className="flex justify-end">
                <Button
                  onClick={handleUploadPackage}
                  loading={updatePackageMutation.isPending}
                >
                  Upload Package
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Back button */}
        <div className="flex justify-start">
          <Button
            variant="secondary"
            onClick={() => navigate(`/skills/${skill.name ?? id}`)}
          >
            Back to Skill
          </Button>
        </div>
      </div>
      </div>
    </PageTransition>
  );
}
