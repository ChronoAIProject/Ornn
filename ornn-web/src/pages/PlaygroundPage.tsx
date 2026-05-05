/**
 * Playground Page — skill-specific chat + preview.
 * Two-column: left chat | right env vars + skill preview.
 * @module pages/PlaygroundPage
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { ChatInput } from "@/components/playground/ChatInput";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { ModelPicker } from "@/components/models/ModelPicker";
import { OverLimitPage } from "@/components/quota/OverLimitPage";
import { QuotaInline } from "@/components/quota/QuotaInline";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";
import { useMyQuota } from "@/hooks/useQuota";
import { useTranslation } from "react-i18next";

/** Extract env var keys from skill metadata */
function extractEnvVarKeys(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return [];
  const runtimes = metadata.runtimes as Array<{ envs?: Array<{ var: string }> }> | undefined;
  if (!runtimes?.length) return [];
  const keys: string[] = [];
  for (const rt of runtimes) {
    if (rt.envs) {
      for (const env of rt.envs) {
        if (env.var && !keys.includes(env.var)) {
          keys.push(env.var);
        }
      }
    }
  }
  return keys;
}

/** Check if skill is runtime-based */
function isRuntimeBased(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  const category = metadata.category as string;
  return category === "runtime-based" || category === "mixed";
}

function ChatMessage({ role, content }: { role: string; content: string }) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded px-3 py-2 font-text text-sm whitespace-pre-wrap ${
          role === "user"
            ? "bg-accent/10 border border-accent/20 text-strong"
            : "bg-elevated border border-accent/10 text-strong"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

export function PlaygroundPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const skillName = searchParams.get("skill");

  const { data: skill, isLoading: skillLoading } = useSkill(skillName ?? "");
  const {
    files: packageFiles,
    fileContents: packageContents,
    isLoading: packageLoading,
  } = useSkillPackage(skill?.presignedPackageUrl);

  // Env var state
  const envVarKeys = useMemo(() => extractEnvVarKeys(skill?.metadata as Record<string, unknown> ?? null), [skill?.metadata]);
  const needsEnvVars = useMemo(() => isRuntimeBased(skill?.metadata as Record<string, unknown> ?? null) && envVarKeys.length > 0, [skill?.metadata, envVarKeys]);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});

  const allEnvVarsFilled = useMemo(() => {
    if (!needsEnvVars) return true;
    return envVarKeys.every((key) => envVars[key]?.trim());
  }, [needsEnvVars, envVarKeys, envVars]);

  const handleEnvVarChange = useCallback((key: string, value: string) => {
    setEnvVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Picked model (forwarded with each send). Picker maintains the
  // localStorage source of truth — we just hold the latest value here so
  // the chat hook can pass it to the SSE endpoint.
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);

  // Caller quota — drives the soft warning + over-limit gate. Admins
  // bypass via `quota.isAdmin` inside the components.
  const { data: quotaSnapshot } = useMyQuota();
  const playgroundSnap = quotaSnapshot?.playground;
  const isOverLimit =
    Boolean(playgroundSnap) &&
    !quotaSnapshot?.isAdmin &&
    playgroundSnap!.monthly.remaining + playgroundSnap!.credits.balance <= 0;

  // Chat
  const {
    messages,
    isStreaming,
    fileOutputs,
    error,
    currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
  } = usePlaygroundChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentAssistantContent]);

  const handleSend = useCallback((content: string) => {
    // Pass skillId, envVars, and the user's picked model with each message.
    sendMessage(
      content,
      skillName ?? undefined,
      needsEnvVars ? envVars : undefined,
      pickedModelId ?? undefined,
    );
  }, [sendMessage, skillName, envVars, needsEnvVars, pickedModelId]);

  // No skill specified
  if (!skillName) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="font-text text-sm text-meta mb-4">
              {t("playground.selectSkill")}
            </p>
            <Link
              to="/registry"
              className="font-text text-sm text-accent hover:underline"
            >
              {t("playground.browseSkills")}
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  // Loading
  if (skillLoading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <Skeleton lines={4} />
        </div>
      </PageTransition>
    );
  }

  if (isOverLimit && playgroundSnap) {
    return (
      <PageTransition>
        <OverLimitPage surface="playground" snapshot={playgroundSnap} />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-1">
        {/* Surface header — bracketed section label on the left, quota
            inline in the middle (admins skip), model picker pinned right.
            The 80% warning banner replaces the inline stamp at threshold. */}
        <div className="mb-3 flex flex-wrap items-center gap-3 shrink-0 border-b border-subtle pb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
            [§&nbsp;PLAYGROUND]
          </span>
          <span aria-hidden="true" className="h-px w-6 bg-accent/40" />
          <span className="font-mono text-[11px] text-strong truncate max-w-[24rem]" title={skillName}>
            {skillName}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <QuotaInline surface="playground" />
            <ModelPicker
              surface="playground"
              onChange={setPickedModelId}
            />
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex flex-1 min-h-0 gap-4">
          {/* Left: Chat (40%) */}
          <div className="flex w-[40%] shrink-0 flex-col min-w-0 min-h-0 rounded border border-accent/10 bg-elevated/30">
            {/* Chat panel header band — bracketed label on left, clear-chat ghost action on right */}
            <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-accent/10 bg-page/40">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta">
                [&nbsp;CHAT&nbsp;]
              </span>
              <button
                type="button"
                onClick={clearChat}
                disabled={messages.length === 0}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta hover:text-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("playground.clearChat")}
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-2">
              {messages.length === 0 && !currentAssistantContent && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent/70 mb-2">
                    [&nbsp;READY&nbsp;]
                  </span>
                  <span aria-hidden="true" className="h-px w-12 bg-accent/30 mb-3" />
                  <p className="font-text text-sm text-strong max-w-sm leading-relaxed">
                    {needsEnvVars && !allEnvVarsFilled
                      ? t("playground.fillEnvVars")
                      : t("playground.askAbout", { name: skillName })}
                  </p>
                  {!(needsEnvVars && !allEnvVarsFilled) && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta mt-3">
                      Enter to send · Shift + Enter for newline
                    </p>
                  )}
                </div>
              )}

              {messages.map((msg) => (
                <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
              ))}

              {currentAssistantContent && (
                <ChatMessage role="assistant" content={currentAssistantContent} />
              )}

              {/* File outputs (images, etc.) */}
              {fileOutputs.map((file, idx) => (
                <div key={`file-${idx}`} className="flex justify-start">
                  <div className="max-w-[85%] rounded border border-accent/20 bg-elevated p-2">
                    {file.mimeType.startsWith("image/") ? (
                      <div>
                        <img
                          src={`data:${file.mimeType};base64,${file.content}`}
                          alt={file.path}
                          className="max-w-full rounded"
                        />
                        <p className="font-mono text-xs text-meta mt-1">{file.path} ({Math.round(file.size / 1024)}KB)</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <a
                          href={`data:${file.mimeType};base64,${file.content}`}
                          download={file.path.split("/").pop()}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          {file.path} ({Math.round(file.size / 1024)}KB)
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {error && (
                <div className="border border-danger/30 bg-danger/5 rounded p-3">
                  <p className="font-text text-xs text-danger">{error}</p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Chat input */}
            <div className="shrink-0 border-t border-accent/10 px-1 pb-1">
              <ChatInput
                onSend={handleSend}
                onAbort={abort}
                disabled={isStreaming || (needsEnvVars && !allEnvVarsFilled)}
                isStreaming={isStreaming}
                placeholder={
                  needsEnvVars && !allEnvVarsFilled
                    ? t("playground.fillFirst")
                    : isStreaming
                    ? "Generating..."
                    : t("playground.askPlaceholder", { name: skillName })
                }
              />
            </div>
          </div>

          {/* Right: Skill info + Env vars + Skill preview (60%) — fill height */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
            {/* Compact skill info card — name, description, identity row.
                Mirrors the SkillHeroStrip silhouette (icon + body) so the
                playground reads as a sibling of the skill detail page,
                without the heavy hero CTA chrome. */}
            {skill && (
              <Card>
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-strong-edge bg-warning-soft text-accent"
                    aria-hidden
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h2 className="font-display text-base font-semibold leading-tight text-strong tracking-tight">
                        {skill.name}
                      </h2>
                      <span className="inline-flex items-center rounded-sm border border-strong-edge px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-strong">
                        v{skill.version}
                      </span>
                      {typeof (skill.metadata as Record<string, unknown> | null)?.category === "string" && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                          {(skill.metadata as Record<string, unknown>).category as string}
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <p className="mt-1.5 font-text text-xs leading-relaxed text-body line-clamp-3">
                        {skill.description}
                      </p>
                    )}
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-meta">
                        {skill.tags.slice(0, 6).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                        {skill.tags.length > 6 && (
                          <span>+{skill.tags.length - 6} more</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Env vars form (only for runtime-based skills with env vars) */}
            {needsEnvVars && (
              <Card>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent mb-3">
                  {t("playground.envVars")}
                </h3>
                <p className="font-text text-xs text-meta mb-3">
                  {t("playground.envVarsDesc")}
                </p>
                <div className="space-y-2">
                  {envVarKeys.map((key) => (
                    <div key={key} className="flex items-center gap-3">
                      <label className="font-mono text-xs text-strong w-48 shrink-0 truncate" title={key}>
                        {key}
                      </label>
                      <input
                        type="text"
                        value={envVars[key] ?? ""}
                        onChange={(e) => handleEnvVarChange(key, e.target.value)}
                        placeholder={t("playground.enterValue")}
                        className="flex-1 rounded border border-accent/20 bg-page px-2 py-1.5 font-mono text-xs text-strong placeholder:text-meta/50 focus:border-accent/50 focus:outline-none"
                      />
                      {envVars[key]?.trim() ? (
                        <Badge color="green">{t("common.set")}</Badge>
                      ) : (
                        <Badge color="cyan">{t("common.required")}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Skill preview — fill remaining height. Bracketed [PACKAGE]
                label wraps the existing files+viewer combo so it reads
                as a sibling of the [CHAT] panel on the left. */}
            <div className="flex-1 min-h-0 flex flex-col rounded border border-accent/10 bg-elevated/30 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-accent/10 bg-page/40">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta">
                  [&nbsp;PACKAGE&nbsp;]
                </span>
                {skill && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta truncate" title={skill.name}>
                    {skill.name}@v{skill.version}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {packageLoading ? (
                  <Card><Skeleton lines={8} /></Card>
                ) : packageFiles.length > 0 ? (
                  <SkillPackagePreview
                    files={packageFiles}
                    fileContents={packageContents}
                    metadata={null}
                    editable={false}
                    className="h-full"
                  />
                ) : (
                  <div className="flex items-center justify-center h-32">
                    <p className="font-text text-xs text-meta">{t("playground.noPackage")}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
