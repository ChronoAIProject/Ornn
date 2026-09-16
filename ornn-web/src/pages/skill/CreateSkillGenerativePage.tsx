/**
 * Create Skill Generative Page.
 *
 * UI/UX language matches the Playground: chat is the page hero (single
 * centered column at `max-w-2xl`), composer pinned to the bottom of the
 * chat column with the model picker + quota chip centered above, and a
 * right-edge slide-in drawer for the work-product (the generated skill
 * package preview + Save action).
 *
 * Different from Playground:
 *   - The drawer is **pinned open by default** because the package
 *     preview IS the artifact being built — not auxiliary context.
 *   - Drawer hosts the Save / Start over actions inline with the
 *     preview.
 *   - Streaming output stays in monospace (the generative artifact is
 *     structured JSON + file contents, not free prose).
 *
 * @module pages/CreateSkillGenerativePage
 */

import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { ChatInput, type ChatInputHandle } from "@/components/playground/ChatInput";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { ValidationErrorPanel } from "@/components/skill/ValidationErrorPanel";
import { GenerationChatMessage } from "@/components/skill/GenerationChatMessage";
import { GenerativeEmptyHero } from "@/components/skill/generative/GenerativeEmptyHero";
import { GenerativePackageRailTab } from "@/components/skill/generative/GenerativePackageRailTab";
import { GenerationModeToggle } from "@/components/skill/generative/GenerationModeToggle";
import { ModelPicker } from "@/components/models/ModelPicker";
import { OverLimitPage } from "@/components/quota/OverLimitPage";
import { QuotaInline } from "@/components/quota/QuotaInline";
import { useGenerationModeCopy, usePreferredGenerationMode } from "@/hooks/useGenerationMode";
import { useGenerativeDrawer } from "@/hooks/useGenerativeDrawer";
import { useSkillGeneration } from "@/hooks/useSkillGeneration";
import { useCreateSkill } from "@/hooks/useSkills";
import { useMyQuota } from "@/hooks/useQuota";
import { useToastStore } from "@/stores/toastStore";
import { useAuthStore } from "@/stores/authStore";
import { track } from "@/lib/analytics";
import { useTranslation } from "react-i18next";
import { extractFrontmatter } from "@/utils/frontmatter";
import {
  validateSkillFrontmatter,
  type FrontmatterValidationError,
} from "@/utils/skillFrontmatterSchema";
import { translateError } from "@/utils/translateError";

/** Welded-seam horizontal divider with a rivet dot in the middle. */
function WeldedSeam({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden>
      <span className="h-px flex-1 bg-strong-edge/40" />
      <span className="h-1 w-1 rounded-full bg-accent/40" />
      <span className="h-px flex-1 bg-strong-edge/40" />
    </div>
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
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const stickToBottomRef = useRef(true);

  // Caller quota — drives the soft warning + over-limit gate.
  const { data: quotaSnapshot } = useMyQuota();
  const skillGenSnap = quotaSnapshot?.skillGen;
  const isOverLimit =
    Boolean(skillGenSnap) &&
    !quotaSnapshot?.isAdmin &&
    skillGenSnap!.remaining <= 0;

  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  // Package shape for the next turn (#1242). Persisted like the model
  // pick; sent with every turn so the user can switch between
  // refinements (e.g. "now add a script" → advanced).
  const [mode, setMode] = usePreferredGenerationMode();
  const modeCopy = useGenerationModeCopy();

  const handleSend = useCallback(
    (content: string) =>
      generation.sendMessage(content, { modelId: pickedModelId ?? undefined, mode }),
    [generation, pickedModelId, mode],
  );

  const handleStarterClick = useCallback((body: string) => {
    chatInputRef.current?.setValue(body);
  }, []);

  // Smart auto-scroll — only follow when the user is at the tail.
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distFromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [generation.chatMessages]);

  // Validate frontmatter whenever SKILL.md content changes in preview.
  const skillMdContent = generation.fileContents.get("SKILL.md") ?? "";
  const validationErrors = useMemo<FrontmatterValidationError[]>(() => {
    if (!skillMdContent) return [];
    const fm = extractFrontmatter(skillMdContent);
    if (!fm) return [{ field: "root", messageKey: "errors.frontmatter.unparseable" }];
    const result = validateSkillFrontmatter(fm);
    if (result.success) return [];
    return result.errors;
  }, [skillMdContent]);

  const hasFrontmatterErrors = validationErrors.length > 0;

  const handleSave = async () => {
    if (hasFrontmatterErrors) {
      addToast({ type: "error", message: t("generative.fixErrors") });
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
      track("skill.created", { skillId: skill.guid, source: "generative" });
      track("skill.published", { skillId: skill.guid, source: "generative" });
      addToast({
        type: "success",
        message: t("generative.saveSuccess", { name: skill.name }),
      });
      navigate(`/skills/${skill.name}`);
    } catch (err) {
      const message =
        translateError(err, t("generative.saveFailed"));
      addToast({ type: "error", message });
    }
  };

  // ── Drawer state — hover / pin / esc / new-iteration hint live in
  // the hook; the drawer for the generative artifact is pinned-open by
  // default since the preview IS the work product.
  const drawer = useGenerativeDrawer(generation.phase);

  const isGenerating = generation.phase === "generating";
  const hasMessages = generation.chatMessages.length > 0;
  const hasPreview = generation.metadata !== null;
  const conversationActive = hasMessages || isGenerating;

  const chatInputPlaceholder = isGenerating
    ? t("generative.placeholder")
    : t(
        "generative.askPlaceholder",
        "Describe the skill you want to create…",
      );

  // #624 — only redirect to the over-limit page on a *fresh* arrival
  // (no messages exchanged AND no generated preview). Once the user
  // has produced a result this session, the quota poll dropping their
  // remaining to 0 should NOT yank the result off-screen; the Send
  // button is already disabled below via `isOverLimit`, which is the
  // right gate (no new generations) without losing what's already on
  // the page. Without this guard, the final allowed generation
  // succeeds → quota refetch → page replaced → user can't save.
  if (
    isOverLimit &&
    skillGenSnap &&
    quotaSnapshot &&
    !hasMessages &&
    !hasPreview
  ) {
    return (
      <PageTransition>
        <OverLimitPage
          surface="skillGen"
          snapshot={skillGenSnap}
          resetAt={quotaSnapshot.nextMonthlyResetAt}
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="relative flex h-full flex-col">
        {/* ─── Chat (page hero) ─── */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-6 pt-1">
            {/* Slim utility row — only when conversation has started */}
            {conversationActive && (
              <div className="mb-1 flex shrink-0 items-center justify-between py-1">
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isGenerating ? "animate-pulse bg-accent" : "bg-transparent"
                  }`}
                />
                <button
                  type="button"
                  onClick={generation.reset}
                  disabled={!hasMessages || isGenerating}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {t("generative.startOver", "Start over")}
                </button>
              </div>
            )}

            {/* Messages scroll area */}
            <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
              {!conversationActive ? (
                /* ─── Empty-state hero ─── */
                <GenerativeEmptyHero onStarterClick={handleStarterClick} />
              ) : (
                /* ─── Conversation ─── */
                <div className="space-y-3 py-3">
                  {generation.chatMessages.map((msg) => (
                    <GenerationChatMessage key={msg.id} message={msg} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Composer — quota + mode + model picker above, ChatGPT-style.
                `flex-wrap` lets the three chips restack on narrow viewports. */}
            <div className="shrink-0 pt-3">
              <div className="mb-2 flex flex-wrap items-center justify-center gap-3">
                <QuotaInline surface="skillGen" />
                <GenerationModeToggle value={mode} onChange={setMode} disabled={isGenerating} />
                <ModelPicker surface="skillGen" onChange={setPickedModelId} />
              </div>
              <ChatInput
                ref={chatInputRef}
                onSend={handleSend}
                onAbort={generation.abort}
                disabled={isGenerating}
                isStreaming={isGenerating}
                placeholder={chatInputPlaceholder}
              />
              {/* Always-visible description of the selected mode — hover
                  `title` on the segments is not a sufficient affordance. */}
              <p
                className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70"
                data-testid="generation-mode-hint"
              >
                <span className="text-accent/80">{modeCopy.labels[mode]}</span>
                {" · "}
                {modeCopy.hints[mode]}
              </p>
              <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                {t("playground.kbHint", "Enter to send · Shift + Enter for newline")}
              </p>
            </div>
          </div>
        </section>

        {/* ─── Right-edge rail — single tab (Package + actions) ─── */}
        <GenerativePackageRailTab
          drawerOpen={drawer.drawerOpen}
          pinnedOpen={drawer.pinnedOpen}
          hasUnseenIteration={drawer.hasUnseenIteration}
          hasFrontmatterErrors={hasFrontmatterErrors}
          onHoverOpen={drawer.openHover}
          onHoverCloseScheduled={drawer.scheduleHoverClose}
          onTogglePin={drawer.togglePin}
        />

        {/* ─── Drawer overlay ─── */}
        <AnimatePresence>
          {drawer.drawerOpen && (
            <>
              {drawer.pinnedOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={drawer.unpin}
                  className="fixed inset-0 z-30 bg-page/30 backdrop-blur-[1px]"
                />
              )}

              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onMouseEnter={drawer.openHover}
                onMouseLeave={drawer.scheduleHoverClose}
                className="card-impression fixed right-10 top-[68px] bottom-4 z-40 flex w-[min(960px,65vw)] max-w-[calc(100vw-3rem)] flex-col rounded-md border border-subtle bg-card"
                role="complementary"
                aria-label={t("aria.skillPackagePreview")}
              >
                {/* Drawer header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-subtle bg-elevated/50 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      [§&nbsp;PACKAGE]
                    </span>
                    {drawer.pinnedOpen && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        {t("generative.pinned", "Pinned")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={drawer.togglePin}
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
                    >
                      {drawer.pinnedOpen
                        ? t("generative.unpin", "Unpin")
                        : t("generative.pin", "Pin")}
                    </button>
                    <button
                      type="button"
                      onClick={drawer.close}
                      aria-label={t("common.aria.closeDrawer")}
                      className="font-mono text-[12px] text-meta transition-colors hover:text-accent"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Drawer body — flex column with the preview claiming the
                    space between validation errors (top) and action buttons
                    (bottom). The body itself does NOT scroll; scrolling lives
                    inside the preview's panes so Start over / Save skill stay
                    visible at all times. */}
                <div className="flex min-h-0 flex-1 flex-col">
                  {hasPreview ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                      {hasFrontmatterErrors && (
                        <ValidationErrorPanel
                          errors={validationErrors}
                          title={t(
                            "generative.validationTitle",
                            "Validation Errors",
                          )}
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
                        className="min-h-0 flex-1"
                      />

                      <WeldedSeam className="shrink-0" />

                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                        <Button variant="secondary" size="sm" onClick={generation.reset}>
                          {t("generative.startOver", "Start over")}
                        </Button>
                        <Button
                          onClick={handleSave}
                          loading={createMutation.isPending}
                          disabled={hasFrontmatterErrors}
                          className="border-success/50 text-success hover:border-success"
                        >
                          {t("generative.saveSkill", "Save skill")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <p className="font-text text-sm text-body">
                        {t(
                          "generative.emptyPreviewHero",
                          "Package preview lands here once the model drafts a skill.",
                        )}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                        {t(
                          "generative.emptyPreviewHint",
                          "Send a prompt on the left to start.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
