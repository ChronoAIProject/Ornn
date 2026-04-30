/**
 * Create Skill Free Page.
 * ZIP upload workflow with client-side validation, frontmatter validation, and preview.
 * @module pages/CreateSkillFreePage
 */

import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { ValidationErrorPanel } from "@/components/skill/ValidationErrorPanel";
import { useCreateSkill } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import {
  validateSkillZip,
  type ZipValidationResult,
} from "@/utils/zipValidator";
import {
  validateSkillFrontmatter,
  type FrontmatterValidationError,
} from "@/utils/skillFrontmatterSchema";
import { formatFileSize } from "@/utils/formatters";
import { MAX_FILE_SIZE_BYTES } from "@/utils/constants";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata } from "@/types/skillPackage";
import { createDefaultSkillMetadata } from "@/types/skillPackage";
import { ArrowLeftIcon, UploadIcon } from "@/components/icons";
import type { SkillCategory } from "@/utils/constants";
import { useTranslation } from "react-i18next";

type FreePageState =
  | "idle"
  | "validating"
  | "valid"
  | "invalid"
  | "warning"
  | "submitting";

/**
 * Build FileNode tree from ZipValidationResult files.
 */
function buildTreeFromValidation(
  result: ZipValidationResult,
): FileNode[] {
  const rootChildren: FileNode[] = [];
  const folderMap = new Map<string, FileNode[]>();

  for (const file of result.files) {
    const parts = file.path.split("/");
    if (parts.length === 1) {
      rootChildren.push({
        id: file.id,
        name: file.path,
        type: "file",
      });
    } else {
      const folder = parts[0];
      const existing = folderMap.get(folder) ?? [];
      existing.push({
        id: file.id,
        name: parts.slice(1).join("/"),
        type: "file",
      });
      folderMap.set(folder, existing);
    }
  }

  for (const [folder, children] of folderMap) {
    rootChildren.push({
      id: folder,
      name: folder,
      type: "folder",
      children,
    });
  }

  return [
    {
      id: "root",
      name: result.metadata?.name ?? "skill-package",
      type: "folder",
      children: rootChildren,
    },
  ];
}

/**
 * Build fileContents map from ZipValidationResult.
 */
function buildContentsMap(
  result: ZipValidationResult,
): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of result.files) {
    if (file.content !== null) {
      contents.set(file.id, file.content);
    }
  }
  return contents;
}

/**
 * Convert parsed frontmatter to SkillMetadata for preview.
 * Handles both new nested and old flat structures via the adapter.
 */
function toSkillMetadata(
  result: ZipValidationResult,
): SkillMetadata | null {
  if (!result.metadata) return null;
  const fm = result.metadata as Record<string, unknown>;

  // Handle nested metadata structure (new format)
  const meta = fm.metadata as Record<string, unknown> | undefined;

  if (meta && typeof meta === "object") {
    return createDefaultSkillMetadata({
      name: (fm.name as string) ?? "unknown",
      description: (fm.description as string) ?? "",
      metadata: {
        category: ((meta.category as string) ?? "plain") as SkillCategory,
        runtime: (meta.runtime as string[]) ?? [],
        runtimeDependency: (meta.runtimeDependency as string[]) ?? [],
        runtimeEnvVar: (meta.runtimeEnvVar as string[]) ?? [],
        toolList: (meta.toolList as string[]) ?? [],
        tag: (meta.tag as string[]) ?? [],
      },
      license: (fm.license as string) ?? "",
      compatibility: (fm.compatibility as string) ?? "",
      disableModelInvocation: (fm.disableModelInvocation as boolean) ?? false,
      userInvocable: (fm.userInvocable as boolean) ?? true,
      allowedTools: (fm.allowedTools as string[]) ?? [],
      model: (fm.model as string) ?? "",
      context: (fm.context as string[]) ?? [],
      agent: (fm.agent as string) ?? "",
      argumentHint: (fm.argumentHint as string) ?? "",
    });
  }

  // Fallback for no metadata block (should not happen after adapter, but safety net)
  return createDefaultSkillMetadata({
    name: (fm.name as string) ?? "unknown",
    description: (fm.description as string) ?? "",
    license: (fm.license as string) ?? "",
  });
}

export function CreateSkillFreePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const createMutation = useCreateSkill();
  const inputRef = useRef<HTMLInputElement>(null);

  const [pageState, setPageState] = useState<FreePageState>("idle");
  const [validationResult, setValidationResult] =
    useState<ZipValidationResult | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [frontmatterErrors, setFrontmatterErrors] = useState<
    FrontmatterValidationError[]
  >([]);
  const [skipValidation, setSkipValidation] = useState(false);

  const previewFiles = validationResult
    ? buildTreeFromValidation(validationResult)
    : [];
  const previewContents = validationResult
    ? buildContentsMap(validationResult)
    : new Map<string, string>();
  const previewMetadata = validationResult
    ? toSkillMetadata(validationResult)
    : null;

  const handleFileSelect = useCallback(async (file: File) => {
    // Reset frontmatter errors
    setFrontmatterErrors([]);

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setPageState("invalid");
      setValidationResult({
        status: "invalid",
        files: [],
        metadata: null,
        errors: [t("free.onlyZip")],
        warnings: [],
      });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setPageState("invalid");
      setValidationResult({
        status: "invalid",
        files: [],
        metadata: null,
        errors: [
          t("free.tooLarge", { size: formatFileSize(file.size) }),
        ],
        warnings: [],
      });
      return;
    }

    setZipFile(file);
    setPageState("validating");

    const result = await validateSkillZip(file);
    setValidationResult(result);

    // If zip structure is valid, also validate the frontmatter schema
    if (result.status !== "invalid" && result.metadata) {
      const fmValidation = validateSkillFrontmatter(result.metadata);
      if (!fmValidation.success) {
        setFrontmatterErrors(fmValidation.errors);
        // Show as warning (don't block preview but block save)
      }
    }

    setPageState(result.status === "invalid" ? "invalid" : result.status);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleReset = useCallback(() => {
    setPageState("idle");
    setValidationResult(null);
    setZipFile(null);
    setFrontmatterErrors([]);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const hasFrontmatterErrors = frontmatterErrors.length > 0;

  const handleSubmit = async () => {
    if (!zipFile) return;
    if (!skipValidation && (!previewMetadata || hasFrontmatterErrors)) return;
    setPageState("submitting");

    try {
      const skill = await createMutation.mutateAsync({ zipFile, skipValidation });
      addToast({
        type: "success",
        message: t("free.uploadSuccess", { name: skill.name }),
      });
      navigate(`/skills/${skill.name}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("free.uploadFailed");
      addToast({ type: "error", message });
      setPageState(
        validationResult?.status === "warning" ? "warning" : "valid",
      );
    }
  };

  const statusBorderColor =
    pageState === "valid"
      ? "border-success/40"
      : pageState === "warning"
        ? "border-warning/40"
        : pageState === "invalid"
          ? "border-danger/40"
          : "border-accent/20";

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <Link
          to="/skills/new"
          className="flex items-center gap-2 mb-6 text-meta hover:text-accent transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="font-text text-sm">{t("free.backToModes")}</span>
        </Link>

        {/* Title */}
        <div className="mb-8">
          <h1 className="accent-support mb-2 font-display text-2xl font-bold tracking-wider text-accent-support sm:text-3xl">
            {t("free.title")}
          </h1>
          <p className="font-text text-meta">
            {t("free.subtitle")}
          </p>
        </div>

        {/* Drop zone */}
        <Card className="mb-6">
          <motion.div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => inputRef.current?.click()}
            whileHover={{ borderColor: "rgba(255, 140, 56, 0.5)" }}
            className={`
              flex cursor-pointer flex-col items-center justify-center rounded-xl
              border-2 border-dashed px-6 py-12 transition-colors
              ${isDragging ? "border-accent-support bg-accent-support/5" : `${statusBorderColor} bg-page/50`}
            `}
          >
            <UploadIcon className="h-12 w-12 text-accent-support mb-4" />
            {zipFile ? (
              <div className="text-center">
                <p className="font-mono text-sm text-accent-support">
                  {zipFile.name}
                </p>
                <p className="mt-1 text-xs text-meta">
                  {formatFileSize(zipFile.size)}
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReset();
                  }}
                  className="mt-2 text-xs text-danger hover:underline cursor-pointer"
                >
                  {t("free.changeFile")}
                </button>
              </div>
            ) : (
              <div className="text-center">
                <p className="font-text text-sm text-meta">
                  {t("free.dropzone")}
                </p>
                <p className="mt-1 text-xs text-meta/60">
                  {t("free.maxSize")}
                </p>
              </div>
            )}
          </motion.div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
            className="hidden"
          />
        </Card>

        {/* Validating state */}
        {pageState === "validating" && (
          <Card className="mb-6">
            <div className="flex items-center justify-center py-8">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent mr-3" />
              <p className="font-text text-sm text-meta">
                {t("free.validating")}
              </p>
            </div>
          </Card>
        )}

        {/* Validation status banner (zip structure) */}
        {validationResult && pageState !== "validating" && (
          <div
            className={`rounded-lg border p-4 mb-6 ${
              pageState === "valid" && !hasFrontmatterErrors
                ? "border-success/40 bg-success/5"
                : pageState === "warning" || hasFrontmatterErrors
                  ? "border-warning/40 bg-warning/5"
                  : "border-danger/40 bg-danger/5"
            }`}
          >
            {validationResult.errors.map((err, i) => (
              <p key={i} className="font-text text-sm text-danger">
                {err}
              </p>
            ))}
            {validationResult.warnings.map((warn, i) => (
              <p key={i} className="font-text text-sm text-warning">
                {warn}
              </p>
            ))}
            {pageState === "valid" && !hasFrontmatterErrors && (
              <p className="font-text text-sm text-success">
                {t("free.valid")}
              </p>
            )}
            {hasFrontmatterErrors && pageState !== "invalid" && (
              <p className="font-text text-sm text-warning mt-1">
                {t("free.validWithErrors")}
              </p>
            )}
          </div>
        )}

        {/* Frontmatter validation errors */}
        {hasFrontmatterErrors && pageState !== "invalid" && (
          <ValidationErrorPanel
            errors={frontmatterErrors}
            className="mb-6"
          />
        )}

        {/* Skip validation toggle + Upload button — visible once a zip is selected */}
        {zipFile && pageState !== "validating" && (
          <div className="mb-6 flex items-center justify-end gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="font-text text-xs text-meta">{t("free.skipValidation")}</span>
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
            </label>
            <Button
              onClick={handleSubmit}
              loading={createMutation.isPending}
              disabled={!skipValidation && (pageState === "invalid" || hasFrontmatterErrors || !previewMetadata)}
            >
              {t("free.uploadSkill")}
            </Button>
          </div>
        )}

        {/* Preview */}
        {((pageState === "valid" ||
          pageState === "warning" ||
          pageState === "submitting") ||
          (skipValidation && validationResult && pageState !== "validating")) &&
          validationResult && (
            <SkillPackagePreview
              files={previewFiles}
              fileContents={previewContents}
              metadata={previewMetadata}
            />
          )}
      </div>
      </div>
    </PageTransition>
  );
}
