/**
 * Active-conversation message stream for PlaygroundPage (#453).
 *
 * Layout: rendered turns + the currently-streaming assistant buffer +
 * ThinkingBubble (between submit and the first streamed token) + file
 * outputs (image inline, others as download links) + error banner +
 * the bottom anchor div the parent scrolls into view.
 *
 * Stateless — the parent owns chat state via `usePlaygroundChat()`
 * and the scroll-anchor ref.
 *
 * @module components/playground/PlaygroundConversation
 */

import { forwardRef } from "react";
import { ChatMessage } from "@/components/playground/ChatMessage";
import { ThinkingBubble } from "@/components/playground/PlaygroundHelpers";
import type { PlaygroundMessage, ToolCallStatus, FileOutput } from "@/types/playground";

export interface PlaygroundConversationProps {
  messages: PlaygroundMessage[];
  isStreaming: boolean;
  toolCallStatuses: Record<string, ToolCallStatus>;
  currentAssistantContent: string;
  fileOutputs: FileOutput[];
  error: string | null;
}

export const PlaygroundConversation = forwardRef<HTMLDivElement, PlaygroundConversationProps>(
  function PlaygroundConversation(
    {
      messages,
      isStreaming,
      toolCallStatuses,
      currentAssistantContent,
      fileOutputs,
      error,
    },
    anchorRef,
  ) {
    return (
      <div className="space-y-3 py-3">
        {messages.map((msg, idx) => {
          const isLastAssistant =
            msg.role === "assistant" &&
            idx === messages.length - 1 &&
            isStreaming;
          return (
            <ChatMessage
              key={msg.id}
              message={msg}
              toolCallStatuses={toolCallStatuses}
              isStreaming={isLastAssistant}
            />
          );
        })}

        {currentAssistantContent && (
          <ChatMessage
            message={{
              id: "streaming-buffer",
              role: "assistant",
              content: currentAssistantContent,
            }}
            toolCallStatuses={toolCallStatuses}
            isStreaming
          />
        )}

        {isStreaming && !currentAssistantContent && <ThinkingBubble />}

        {fileOutputs.map((file, idx) => (
          <div key={`file-${idx}`} className="flex justify-start">
            <div className="max-w-[88%] rounded-sm border border-subtle bg-card p-2.5">
              {file.mimeType.startsWith("image/") ? (
                <div>
                  <img
                    src={`data:${file.mimeType};base64,${file.content}`}
                    alt={file.path}
                    className="max-w-full rounded-sm"
                  />
                  <p className="mt-1.5 font-mono text-[10px] text-meta">
                    {file.path} ({Math.round(file.size / 1024)}KB)
                  </p>
                </div>
              ) : (
                <a
                  href={`data:${file.mimeType};base64,${file.content}`}
                  download={file.path.split("/").pop()}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {file.path} ({Math.round(file.size / 1024)}KB)
                </a>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
            <p className="font-text text-xs text-danger">{error}</p>
          </div>
        )}

        <div ref={anchorRef} />
      </div>
    );
  },
);
