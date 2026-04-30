/**
 * Chat Message Component.
 * Renders a single message bubble with role-based styling.
 * Supports markdown rendering for assistant messages.
 * @module components/playground/ChatMessage
 */

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { ToolCallCard } from "./ToolCallCard";
import { ToolIcon } from "./PlaygroundIcons";
import type {
  PlaygroundMessage,
  ToolCallStatus,
} from "@/types/playground";

export interface ChatMessageProps {
  message: PlaygroundMessage;
  toolCallStatuses: Record<string, ToolCallStatus>;
  isStreaming?: boolean;
}

const messageVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export function ChatMessage({
  message,
  toolCallStatuses,
  isStreaming = false,
}: ChatMessageProps) {
  if (message.role === "user") {
    return <UserMessage content={message.content} />;
  }

  if (message.role === "assistant") {
    return (
      <AssistantMessage
        content={message.content}
        toolCalls={message.toolCalls}
        toolCallStatuses={toolCallStatuses}
        isStreaming={isStreaming}
      />
    );
  }

  if (message.role === "tool") {
    return (
      <ToolResultMessage
        content={message.content}
        toolCallId={message.toolCallId}
      />
    );
  }

  // system messages are hidden from the UI
  return null;
}

function UserMessage({ content }: { content: string }) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-end"
    >
      <div className="max-w-[80%] rounded rounded-br-sm border border-accent/30 bg-accent/5 px-4 py-3">
        <p className="whitespace-pre-wrap font-text text-sm text-strong">
          {content}
        </p>
      </div>
    </motion.div>
  );
}

function AssistantMessage({
  content,
  toolCalls,
  toolCallStatuses,
  isStreaming,
}: {
  content: string;
  toolCalls?: PlaygroundMessage["toolCalls"];
  toolCallStatuses: Record<string, ToolCallStatus>;
  isStreaming: boolean;
}) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div className="max-w-[85%] space-y-3">
        {content && (
          <div className="bg-card rounded rounded-bl-sm px-4 py-3">
            <div className="markdown-body text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize, rehypeHighlight]}
              >
                {content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block h-4 w-1.5 animate-blink bg-accent/80" />
              )}
            </div>
          </div>
        )}

        {toolCalls?.map((tc) => (
          <ToolCallCard
            key={tc.id}
            toolCall={tc}
            status={toolCallStatuses[tc.id] ?? "pending"}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ToolResultMessage({
  content,
  toolCallId,
}: {
  content: string;
  toolCallId?: string;
}) {
  const isRejection = content.startsWith("User rejected execution");

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div
        className={`max-w-[85%] rounded border px-3 py-2 ${
          isRejection
            ? "border-danger/30 bg-danger/5"
            : "border-accent/20 bg-card/50"
        }`}
      >
        <div className="flex items-center gap-2">
          <ToolIcon className="h-3.5 w-3.5 shrink-0 text-meta" />
          <span className="font-display text-[10px] uppercase tracking-wider text-meta">
            Tool Result{toolCallId ? ` (${toolCallId.slice(0, 8)})` : ""}
          </span>
        </div>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-strong/80">
          {content}
        </pre>
      </div>
    </motion.div>
  );
}

