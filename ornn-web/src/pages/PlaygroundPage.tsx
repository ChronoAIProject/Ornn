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
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";
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
        className={`max-w-[85%] rounded-lg px-3 py-2 font-text text-sm whitespace-pre-wrap ${
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
    // Pass skillId and envVars with the message
    sendMessage(content, skillName ?? undefined, needsEnvVars ? envVars : undefined);
  }, [sendMessage, skillName, envVars, needsEnvVars]);

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

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-1">
        {/* Two-column layout */}
        <div className="flex flex-1 min-h-0 gap-4">
          {/* Left: Chat (40%) */}
          <div className="flex w-[40%] shrink-0 flex-col min-w-0 min-h-0 rounded-lg border border-accent/10 bg-elevated/30">
            {/* Clear Chat button inside chat panel */}
            <div className="flex items-center justify-end px-3 py-1 shrink-0">
              <button
                type="button"
                onClick={clearChat}
                className="font-text text-xs text-meta hover:text-accent transition-colors cursor-pointer"
              >
                {t("playground.clearChat")}
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-2">
              {messages.length === 0 && !currentAssistantContent && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="font-text text-sm text-meta max-w-sm">
                    {needsEnvVars && !allEnvVarsFilled
                      ? t("playground.fillEnvVars")
                      : t("playground.askAbout", { name: skillName })}
                  </p>
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
                  <div className="max-w-[85%] rounded-lg border border-accent/20 bg-elevated p-2">
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
                <div className="border border-danger/30 bg-danger/5 rounded-lg p-3">
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

          {/* Right: Env vars + Skill preview (60%) — fill height */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-4">
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

            {/* Skill preview — fill remaining height */}
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
    </PageTransition>
  );
}
