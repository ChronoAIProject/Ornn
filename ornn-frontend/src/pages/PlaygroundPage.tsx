/**
 * Playground Page — skill-specific chat + preview.
 * Two-column: left chat | right env vars + skill preview.
 * @module pages/PlaygroundPage
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { ChatInput } from "@/components/playground/ChatInput";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";

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
        className={`max-w-[85%] rounded-lg px-3 py-2 font-body text-sm whitespace-pre-wrap ${
          role === "user"
            ? "bg-neon-cyan/10 border border-neon-cyan/20 text-text-primary"
            : "bg-bg-elevated border border-neon-cyan/10 text-text-primary"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

export function PlaygroundPage() {
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
            <p className="font-body text-sm text-text-muted mb-4">
              Select a skill to try in the playground.
            </p>
            <Link
              to="/"
              className="font-body text-sm text-neon-cyan hover:underline"
            >
              Browse Skills
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
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between py-2 shrink-0">
          <Link
            to={`/skills/${skillName}`}
            className="flex items-center gap-2 text-text-muted hover:text-neon-cyan transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="font-body text-sm">Back to {skillName}</span>
          </Link>
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-neon-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h1 className="font-heading text-lg font-bold tracking-wider text-neon-cyan">
              PLAYGROUND
            </h1>
          </div>
          <Button variant="secondary" size="sm" onClick={clearChat}>
            Clear Chat
          </Button>
        </div>

        {/* Two-column layout */}
        <div className="flex flex-1 min-h-0 gap-4 pb-2">
          {/* Left: Chat (40%) */}
          <div className="flex w-[40%] shrink-0 flex-col min-w-0 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-2 py-2">
              {messages.length === 0 && !currentAssistantContent && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="font-body text-sm text-text-muted max-w-sm">
                    {needsEnvVars && !allEnvVarsFilled
                      ? "Fill in the required environment variables on the right to start chatting."
                      : `Ask me anything about "${skillName}" or tell me to run it.`}
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
                  <div className="max-w-[85%] rounded-lg border border-neon-cyan/20 bg-bg-elevated p-2">
                    {file.mimeType.startsWith("image/") ? (
                      <div>
                        <img
                          src={`data:${file.mimeType};base64,${file.content}`}
                          alt={file.path}
                          className="max-w-full rounded"
                        />
                        <p className="font-mono text-xs text-text-muted mt-1">{file.path} ({Math.round(file.size / 1024)}KB)</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <a
                          href={`data:${file.mimeType};base64,${file.content}`}
                          download={file.path.split("/").pop()}
                          className="font-mono text-xs text-neon-cyan hover:underline"
                        >
                          {file.path} ({Math.round(file.size / 1024)}KB)
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {error && (
                <div className="border border-neon-red/30 bg-neon-red/5 rounded-lg p-3">
                  <p className="font-body text-xs text-neon-red">{error}</p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Chat input */}
            <div className="shrink-0 border-t border-neon-cyan/10">
              <ChatInput
                onSend={handleSend}
                onAbort={abort}
                disabled={isStreaming || (needsEnvVars && !allEnvVarsFilled)}
                isStreaming={isStreaming}
                placeholder={
                  needsEnvVars && !allEnvVarsFilled
                    ? "Fill in env vars to start chatting..."
                    : isStreaming
                    ? "Generating..."
                    : `Ask about "${skillName}" or tell me to run it...`
                }
              />
            </div>
          </div>

          {/* Right: Env vars + Skill preview (60%) */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto gap-4">
            {/* Env vars form (only for runtime-based skills with env vars) */}
            {needsEnvVars && (
              <Card>
                <h3 className="font-heading text-sm uppercase tracking-wider text-neon-cyan mb-3">
                  Environment Variables
                </h3>
                <p className="font-body text-xs text-text-muted mb-3">
                  This skill requires the following environment variables. Fill them in before chatting.
                </p>
                <div className="space-y-2">
                  {envVarKeys.map((key) => (
                    <div key={key} className="flex items-center gap-3">
                      <label className="font-mono text-xs text-text-primary w-48 shrink-0 truncate" title={key}>
                        {key}
                      </label>
                      <input
                        type="text"
                        value={envVars[key] ?? ""}
                        onChange={(e) => handleEnvVarChange(key, e.target.value)}
                        placeholder="Enter value..."
                        className="flex-1 rounded border border-neon-cyan/20 bg-bg-deep px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-neon-cyan/50 focus:outline-none"
                      />
                      {envVars[key]?.trim() ? (
                        <Badge color="green">Set</Badge>
                      ) : (
                        <Badge color="cyan">Required</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Skill preview */}
            {packageLoading ? (
              <Card><Skeleton lines={8} /></Card>
            ) : packageFiles.length > 0 ? (
              <SkillPackagePreview
                files={packageFiles}
                fileContents={packageContents}
                metadata={null}
                editable={false}
              />
            ) : (
              <div className="flex items-center justify-center h-32">
                <p className="font-body text-xs text-text-muted">No package contents</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
