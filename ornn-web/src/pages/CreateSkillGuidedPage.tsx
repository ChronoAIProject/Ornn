/**
 * Create Skill Guided Page.
 * Multi-step wizard for creating skills with guided inputs.
 * Uses nested metadata structure for the frontmatter schema.
 * @module pages/CreateSkillGuidedPage
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StepIndicator, CompactStepIndicator } from "@/components/form/StepIndicator";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "@/components/icons";
import { StepBasicInfo } from "@/components/skill/guided/StepBasicInfo";
import { StepContent } from "@/components/skill/guided/StepContent";
import { StepFiles } from "@/components/skill/guided/StepFiles";
import { StepPreview } from "@/components/skill/guided/StepPreview";
import { useCreateSkill } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { useAuthStore } from "@/stores/authStore";
import { buildSkillMd } from "@/utils/frontmatterBuilder";
import { buildFileTreeFromFolders, readUploadedFileContents } from "@/utils/fileTreeBuilder";
import { basicInfoSchema, contentSchema, type BasicInfoData, type ContentData } from "@/utils/skillCreateSchemas";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata, SkillMetadataBlock, UploadableFolder } from "@/types/skillPackage";
import { createDefaultSkillMetadata } from "@/types/skillPackage";
import type { SkillCategory } from "@/utils/constants";
import { useTranslation } from "react-i18next";

interface FormState {
  name: string;
  description: string;
  metadata: SkillMetadataBlock;
  license: string;
  compatibility: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  model: string;
  context: string[];
  agent: string;
  argumentHint: string;
  readmeMd: string;
  folderFiles: Map<UploadableFolder, File[]>;
}

const STEPS = [
  { id: "basic", labelKey: "guided.stepBasic", descKey: "guided.stepBasicDesc" },
  { id: "content", labelKey: "guided.stepContent", descKey: "guided.stepContentDesc" },
  { id: "files", labelKey: "guided.stepFiles", descKey: "guided.stepFilesDesc" },
  { id: "preview", labelKey: "guided.stepPreview", descKey: "guided.stepPreviewDesc" },
];

/** Build SkillMetadata from form state. */
function buildMetadata(formData: FormState): SkillMetadata {
  return createDefaultSkillMetadata({
    name: formData.name,
    description: formData.description,
    metadata: formData.metadata,
    license: formData.license,
    compatibility: formData.compatibility,
    disableModelInvocation: formData.disableModelInvocation,
    userInvocable: formData.userInvocable,
    allowedTools: formData.allowedTools,
    model: formData.model,
    context: formData.context,
    agent: formData.agent,
    argumentHint: formData.argumentHint,
  });
}

export function CreateSkillGuidedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const createMutation = useCreateSkill();
  const user = useAuthStore((s) => s.user);

  const translatedSteps = STEPS.map(s => ({ ...s, label: t(s.labelKey), description: t(s.descKey) }));

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormState>({
    name: "",
    description: "",
    metadata: {
      category: "plain" as SkillCategory,
      runtime: [],
      runtimeDependency: [],
      runtimeEnvVar: [],
      toolList: [],
      tag: [],
    },
    license: "",
    compatibility: "",
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [],
    model: "",
    context: [],
    agent: "",
    argumentHint: "",
    readmeMd: "",
    folderFiles: new Map([
      ["scripts", []],
      ["references", []],
      ["assets", []],
    ]),
  });

  // Preview state
  const [previewFiles, setPreviewFiles] = useState<FileNode[]>([]);
  const [previewContents, setPreviewContents] = useState<Map<string, string>>(
    new Map(),
  );

  // Basic info form (nested metadata)
  const basicInfoForm = useForm<BasicInfoData>({
    resolver: zodResolver(basicInfoSchema),
    defaultValues: {
      name: formData.name,
      description: formData.description,
      metadata: formData.metadata,
      license: formData.license,
      compatibility: formData.compatibility,
      disableModelInvocation: formData.disableModelInvocation,
      userInvocable: formData.userInvocable,
      allowedTools: formData.allowedTools,
      model: formData.model,
      context: formData.context,
      agent: formData.agent,
      argumentHint: formData.argumentHint,
    },
  });

  // Content form
  const contentForm = useForm<ContentData>({
    resolver: zodResolver(contentSchema),
    defaultValues: {
      readmeMd: formData.readmeMd,
    },
  });

  // Watch category for conditional fields (nested path)
  const watchedCategory = basicInfoForm.watch("metadata.category");
  const showTools =
    watchedCategory === "tool-based" || watchedCategory === "mixed";
  const showRuntimes =
    watchedCategory === "runtime-based" || watchedCategory === "mixed";

  // Clear conditional fields when category changes
  useEffect(() => {
    if (!showTools) {
      basicInfoForm.setValue("metadata.toolList", []);
    }
    if (!showRuntimes) {
      basicInfoForm.setValue("metadata.runtime", []);
      basicInfoForm.setValue("metadata.runtimeDependency", []);
      basicInfoForm.setValue("metadata.runtimeEnvVar", []);
    }
  }, [showTools, showRuntimes, basicInfoForm]);

  // Beforeunload warning when form has data
  useEffect(() => {
    const hasData = formData.name || formData.description || formData.readmeMd;
    if (!hasData) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formData.name, formData.description, formData.readmeMd]);

  // Build preview data when entering step 4
  useEffect(() => {
    if (currentStep !== 3) return;

    const buildPreview = async () => {
      const metadata = buildMetadata(formData);
      const skillMdContent = buildSkillMd(metadata, formData.readmeMd);
      const fileContents = await readUploadedFileContents(formData.folderFiles);
      fileContents.set("SKILL.md", skillMdContent);

      setPreviewFiles(buildFileTreeFromFolders(formData.name, formData.folderFiles));
      setPreviewContents(fileContents);
    };

    buildPreview();
  }, [currentStep, formData]);

  const previewMetadata = useMemo<SkillMetadata | null>(() => {
    if (currentStep !== 3) return null;
    return buildMetadata(formData);
  }, [currentStep, formData]);

  const handleNextStep = useCallback(async () => {
    if (currentStep === 0) {
      const isValid = await basicInfoForm.trigger();
      if (isValid) {
        const data = basicInfoForm.getValues();
        setFormData((prev) => ({
          ...prev,
          name: data.name,
          description: data.description,
          metadata: data.metadata,
          license: data.license ?? "",
          compatibility: data.compatibility ?? "",
          disableModelInvocation: data.disableModelInvocation,
          userInvocable: data.userInvocable,
          allowedTools: data.allowedTools,
          model: data.model ?? "",
          context: data.context,
          agent: data.agent ?? "",
          argumentHint: data.argumentHint ?? "",
        }));
        setCurrentStep(1);
      }
    } else if (currentStep === 1) {
      const isValid = await contentForm.trigger();
      if (isValid) {
        const data = contentForm.getValues();
        setFormData((prev) => ({ ...prev, ...data }));
        setCurrentStep(2);
      }
    } else if (currentStep === 2) {
      setCurrentStep(3);
    }
  }, [currentStep, basicInfoForm, contentForm]);

  const handlePrevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handleFolderUpload = useCallback(
    (folder: UploadableFolder, file: File) => {
      setFormData((prev) => {
        const newMap = new Map(prev.folderFiles);
        const existing = newMap.get(folder) ?? [];
        newMap.set(folder, [...existing, file]);
        return { ...prev, folderFiles: newMap };
      });
    },
    [],
  );

  const handleFolderRemove = useCallback(
    (folder: UploadableFolder, index: number) => {
      setFormData((prev) => {
        const newMap = new Map(prev.folderFiles);
        const existing = newMap.get(folder) ?? [];
        newMap.set(
          folder,
          existing.filter((_, i) => i !== index),
        );
        return { ...prev, folderFiles: newMap };
      });
    },
    [],
  );

  const handleSubmit = async () => {
    const metadata = buildMetadata(formData);
    const skillMd = buildSkillMd(metadata, formData.readmeMd);

    // Build a ZIP file containing SKILL.md and uploaded files inside a root folder
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const root = formData.name || "skill";
    zip.file(`${root}/SKILL.md`, skillMd);

    // Add folder files under the root
    for (const [folder, files] of formData.folderFiles) {
      for (const file of files) {
        const content = await file.arrayBuffer();
        zip.file(`${root}/${folder}/${file.name}`, content);
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const zipFile = new File([blob], `${formData.name || "skill"}.zip`, {
      type: "application/zip",
    });

    try {
      const skill = await createMutation.mutateAsync({ zipFile });
      addToast({
        type: "success",
        message: t("guided.saveSuccess", { name: skill.name }),
      });
      navigate(`/skills/${skill.name}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("guided.saveFailed");
      addToast({ type: "error", message });
    }
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="neon-cyan mb-2 font-heading text-2xl font-bold tracking-wider text-neon-cyan sm:text-3xl">
            {t("guided.header")}
          </h1>
          <p className="font-body text-text-muted">
            {t("guided.headerDesc")}
          </p>
        </div>

        {/* Step indicator (desktop) */}
        <div className="hidden md:block mb-8">
          <StepIndicator
            steps={translatedSteps}
            currentStep={currentStep}
            clickable
            onStepClick={(step) => {
              if (step < currentStep) setCurrentStep(step);
            }}
          />
        </div>

        {/* Step indicator (mobile) */}
        <div className="md:hidden mb-6">
          <CompactStepIndicator
            currentStep={currentStep}
            totalSteps={translatedSteps.length}
            currentLabel={translatedSteps[currentStep].label}
          />
        </div>

        {/* Step content */}
        <Card className="min-h-[400px]">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <StepBasicInfo
                form={basicInfoForm}
                showTools={showTools}
                showRuntimes={showRuntimes}
              />
            )}
            {currentStep === 1 && <StepContent form={contentForm} />}
            {currentStep === 2 && (
              <StepFiles
                folderFiles={formData.folderFiles}
                onUpload={handleFolderUpload}
                onRemove={handleFolderRemove}
              />
            )}
            {currentStep === 3 && (
              <StepPreview
                files={previewFiles}
                fileContents={previewContents}
                metadata={previewMetadata}
                authorName={user?.displayName ?? undefined}
              />
            )}
          </AnimatePresence>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-neon-cyan/10">
            <Button
              variant="secondary"
              onClick={handlePrevStep}
              disabled={currentStep === 0}
              className={currentStep === 0 ? "invisible" : ""}
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              {t("common.back")}
            </Button>

            {currentStep < translatedSteps.length - 1 ? (
              <Button onClick={handleNextStep}>
                {t("common.next")}
                <ArrowRightIcon className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                loading={createMutation.isPending}
              >
                <CheckIcon className="h-4 w-4 mr-2" />
                {t("guided.createSkill")}
              </Button>
            )}
          </div>
        </Card>
      </div>
      </div>
    </PageTransition>
  );
}
