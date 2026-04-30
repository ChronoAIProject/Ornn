/**
 * Create Skill Generative Page.
 * Two-column layout: multi-turn chat (left) + LLM config & package preview (right).
 * @module pages/CreateSkillGenerativePage
 */

import { useRef, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { ChatInput } from "@/components/playground/ChatInput";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { ValidationErrorPanel } from "@/components/skill/ValidationErrorPanel";
import { GenerationChatMessage } from "@/components/skill/GenerationChatMessage";
import { useSkillGeneration } from "@/hooks/useSkillGeneration";
import { useCreateSkill } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { useAuthStore } from "@/stores/authStore";
import { useTranslation } from "react-i18next";
import { extractFrontmatter } from "@/utils/frontmatter";
import {
  validateSkillFrontmatter,
  type FrontmatterValidationError,
} from "@/utils/skillFrontmatterSchema";

/** Arrow left icon */
function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

/** Sparkle/AI icon */
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    </svg>
  );
}

export function CreateSkillGenerativePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const createMutation = useCreateSkill();
  const user = useAuthStore((s) => s.user);
  const generation = useSkillGeneration();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generation.chatMessages]);

  // Validate frontmatter whenever SKILL.md content changes in preview
  const skillMdContent = generation.fileContents.get("SKILL.md") ?? "";
  const validationErrors = useMemo<FrontmatterValidationError[]>(() => {
    if (!skillMdContent) return [];
    const fm = extractFrontmatter(skillMdContent);
    if (!fm) return [{ field: "root", message: "Could not parse SKILL.md frontmatter" }];
    const result = validateSkillFrontmatter(fm);
    if (result.success) return [];
    return result.errors;
  }, [skillMdContent]);

  const hasFrontmatterErrors = validationErrors.length > 0;

  const handleSave = async () => {
    if (hasFrontmatterErrors) {
      addToast({
        type: "error",
        message: t("generative.fixErrors"),
      });
      return;
    }

    const metadata = generation.metadata;
    if (!metadata) return;

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const root = metadata.name || "skill";

    for (const [id, content] of generation.fileContents) {
      zip.file(`${root}/${id}`, content);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const zipFile = new File([blob], `${metadata.name || "skill"}.zip`, {
      type: "application/zip",
    });

    try {
      const skill = await createMutation.mutateAsync({ zipFile });
      addToast({
        type: "success",
        message: t("generative.saveSuccess", { name: skill.name }),
      });
      navigate(`/skills/${skill.name}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("generative.saveFailed");
      addToast({ type: "error", message });
    }
  };

  const isGenerating = generation.phase === "generating";
  const hasMessages = generation.chatMessages.length > 0;
  const hasPreview = generation.metadata !== null;

  const chatInputPlaceholder = isGenerating
    ? t("generative.placeholder")
    : "Describe the skill you want to create... (Enter to send)";

  return (
    <PageTransition>
      <div className="flex flex-col h-full">
        {/* Header row */}
        <div className="flex items-center justify-between py-2 shrink-0">
          <Link
            to="/skills/new"
            className="flex items-center gap-2 text-meta hover:text-accent transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="font-text text-sm">{t("generative.backToModes")}</span>
          </Link>
        </div>

        {/* Main two-column layout — left chat narrower, right preview wider */}
        <div className="flex flex-1 min-h-0 gap-4 pb-2">
          {/* Left: Chat panel (35%) */}
          <div className="flex w-[35%] shrink-0 flex-col min-w-0 min-h-0 rounded border border-accent/10 bg-elevated/30">
            {/* Chat messages area — scrolls independently */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-3 py-3">
              {!hasMessages && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center"
                >
                  <SparkleIcon className="h-12 w-12 text-accent/30 mb-4" />
                  <p className="font-text text-sm text-meta max-w-sm">
                    {t("generative.desc")}
                  </p>
                  <p className="font-text text-xs text-meta/60 mt-3">
                    {t("generative.note")}
                  </p>
                </motion.div>
              )}

              {generation.chatMessages.map((msg) => (
                <GenerationChatMessage key={msg.id} message={msg} />
              ))}

              <div ref={messagesEndRef} />
            </div>

            {/* Chat input (fixed at bottom) */}
            <div className="shrink-0 border-t border-accent/10 px-1 pb-1">
              <ChatInput
                onSend={generation.sendMessage}
                onAbort={generation.abort}
                disabled={isGenerating}
                isStreaming={isGenerating}
                placeholder={chatInputPlaceholder}
              />
            </div>
          </div>

          {/* Right: Config + Preview panel (65%) — scrolls independently */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {hasPreview ? (
              <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
                {hasFrontmatterErrors && (
                  <ValidationErrorPanel
                    errors={validationErrors}
                    title="Validation Errors"
                  />
                )}

                <SkillPackagePreview
                  files={generation.parsedFiles}
                  fileContents={generation.fileContents}
                  metadata={generation.metadata}
                  editable
                  onContentChange={generation.updateFileContent}
                  onFileDelete={generation.deleteFile}
                  authorName={user?.displayName ?? undefined}
                />

                <div className="flex items-center justify-between shrink-0 py-2">
                  <Button variant="secondary" size="sm" onClick={generation.reset}>
                    {t("generative.startOver")}
                  </Button>
                  <Button
                    onClick={handleSave}
                    loading={createMutation.isPending}
                    disabled={hasFrontmatterErrors}
                    className="border-success/50 text-success hover:border-success"
                  >
                    {t("generative.saveSkill")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="font-text text-xs text-meta">
                  {t("generative.emptyPreview")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
