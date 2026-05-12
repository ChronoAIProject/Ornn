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
import { ModelPicker } from "@/components/models/ModelPicker";
import { OverLimitPage } from "@/components/quota/OverLimitPage";
import { QuotaInline } from "@/components/quota/QuotaInline";
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

interface PromptStarter {
  label: string;
  body: string;
}

type TFunc = ReturnType<typeof import("react-i18next").useTranslation>["t"];

function defaultPromptStarters(t: TFunc): PromptStarter[] {
  return [
    {
      label: t("generative.starter1Label", "Slack notifier"),
      body: t(
        "generative.starter1Body",
        "Build a skill that posts a formatted message to a Slack channel via webhook. Take channel + message as inputs.",
      ),
    },
    {
      label: t("generative.starter2Label", "Fetch GitHub PRs"),
      body: t(
        "generative.starter2Body",
        "Build a skill that lists open pull requests for a given GitHub repo, sorted by latest activity.",
      ),
    },
    {
      label: t("generative.starter3Label", "CSV → JSON"),
      body: t(
        "generative.starter3Body",
        "Build a skill that reads a CSV file and outputs a JSON array, inferring types per column.",
      ),
    },
  ];
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

  const handleSend = useCallback(
    (content: string) => generation.sendMessage(content, pickedModelId ?? undefined),
    [generation, pickedModelId],
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

  // ── Drawer state — same primitive as the playground, but the drawer
  // for the generative artifact is pinned-open by default since the
  // preview IS the work product.
  const [hoverDrawerOpen, setHoverDrawerOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openHover = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoverDrawerOpen(true);
  }, []);
  const scheduleHoverClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHoverDrawerOpen(false);
      closeTimerRef.current = null;
    }, 220);
  }, []);
  const togglePin = useCallback(() => {
    setPinnedOpen((cur) => !cur);
    setHoverDrawerOpen(false);
  }, []);

  // Esc closes a pinned drawer.
  useEffect(() => {
    if (!pinnedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinnedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedOpen]);

  const isGenerating = generation.phase === "generating";
  const hasMessages = generation.chatMessages.length > 0;
  const hasPreview = generation.metadata !== null;
  const conversationActive = hasMessages || isGenerating;
  const drawerOpen = pinnedOpen || hoverDrawerOpen;
  const starters = defaultPromptStarters(t);

  const chatInputPlaceholder = isGenerating
    ? t("generative.placeholder")
    : t(
        "generative.askPlaceholder",
        "Describe the skill you want to create…",
      );

  if (isOverLimit && skillGenSnap && quotaSnapshot) {
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
                <div className="flex h-full flex-col items-center justify-center py-8">
                  <div className="w-full space-y-6 text-center">
                    <div className="space-y-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-meta">
                        {t("generative.eyebrow", "Generative skill builder")}
                      </div>
                      <h2 className="font-display text-3xl font-semibold leading-[1.15] tracking-tight text-strong">
                        {t("generative.heroTitle", "Describe a skill. Build it.")}
                      </h2>
                      <p className="font-text text-[15px] leading-relaxed text-body">
                        {t(
                          "generative.heroSubtitle",
                          "Tell the model what the skill should do. It drafts the package; you iterate; you save.",
                        )}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {starters.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => handleStarterClick(s.body)}
                          className="group flex flex-col items-start gap-1 rounded-xl border border-subtle bg-card/60 px-3.5 py-3 text-left transition-all hover:border-accent/60 hover:bg-card"
                        >
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                            {s.label}
                          </span>
                          <span className="line-clamp-2 font-text text-[13px] leading-snug text-body">
                            {s.body}
                          </span>
                        </button>
                      ))}
                    </div>

                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                      {t(
                        "generative.drawerHint",
                        "Package preview + Save on the right edge",
                      )}
                    </p>
                  </div>
                </div>
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

            {/* Composer — model picker + quota above, ChatGPT-style. */}
            <div className="shrink-0 pt-3">
              <div className="mb-2 flex items-center justify-center gap-3">
                <QuotaInline surface="skillGen" />
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
              <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                {t("playground.kbHint", "Enter to send · Shift + Enter for newline")}
              </p>
            </div>
          </div>
        </section>

        {/* ─── Right-edge rail — single tab (Package + actions) ─── */}
        <div
          className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1"
          onMouseLeave={scheduleHoverClose}
        >
          <button
            type="button"
            onMouseEnter={openHover}
            onClick={togglePin}
            className={`group relative flex items-center gap-1.5 rounded-l-sm border-y border-l px-2.5 py-3 transition-all ${
              drawerOpen
                ? "border-accent/60 bg-card text-accent"
                : "border-subtle bg-card/80 text-meta hover:border-accent/40 hover:text-strong"
            }`}
            aria-label={t("aria.skillPackageDrawer")}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {t("generative.tabPackage", "Package")}
            </span>
            {hasFrontmatterErrors && (
              <span
                className="absolute -left-1 top-2 h-1.5 w-1.5 rounded-full bg-warning"
                aria-hidden
              />
            )}
            {pinnedOpen && (
              <span
                className="absolute -left-px inset-y-2 w-px bg-accent"
                aria-hidden
              />
            )}
          </button>
        </div>

        {/* ─── Drawer overlay ─── */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              {pinnedOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setPinnedOpen(false)}
                  className="fixed inset-0 z-30 bg-page/30 backdrop-blur-[1px]"
                />
              )}

              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onMouseEnter={openHover}
                onMouseLeave={scheduleHoverClose}
                className="card-impression fixed right-10 top-4 bottom-4 z-40 flex w-[520px] max-w-[calc(100vw-3rem)] flex-col rounded-md border border-subtle bg-card"
                role="complementary"
                aria-label={t("aria.skillPackagePreview")}
              >
                {/* Drawer header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-subtle bg-elevated/50 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      [§&nbsp;PACKAGE]
                    </span>
                    {pinnedOpen && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        {t("generative.pinned", "Pinned")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePin}
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
                    >
                      {pinnedOpen
                        ? t("generative.unpin", "Unpin")
                        : t("generative.pin", "Pin")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPinnedOpen(false);
                        setHoverDrawerOpen(false);
                      }}
                      aria-label={t("common.aria.closeDrawer")}
                      className="font-mono text-[12px] text-meta transition-colors hover:text-accent"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Drawer body */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {hasPreview ? (
                    <div className="flex flex-col gap-4 p-4">
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
                      />

                      <WeldedSeam />

                      <div className="flex flex-wrap items-center justify-between gap-3">
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
