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

/**
 * Message entrance choreography. Tuned for chat: each new turn lands
 * with a brief rise + soft scale-in (98 → 100%) on a low-stiffness
 * spring. The values are intentionally small — a chat transcript
 * crossfading wildly between turns is distracting, but a fully-static
 * pop-in feels mechanical. This sits in the middle.
 */
const messageVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

const messageTransition = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 0.6,
} as const;

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
      transition={messageTransition}
      className="flex justify-end"
    >
      {/* User turn — ember-tinted bubble per Forge palette.
          Background is the warm-soft accent fill; border picks up the
          ember at low opacity so the bubble reads as warm "speaker"
          contrasted against the assistant's cool card. */}
      <div className="max-w-[80%] rounded-2xl border border-accent/30 bg-warning-soft px-4 py-2.5">
        <p className="whitespace-pre-wrap font-text text-[15px] leading-7 text-strong">
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
      transition={messageTransition}
      className="flex justify-start"
    >
      <div className="max-w-[88%] space-y-3">
        {content && (
          /* Soft bubble — distinct from the user's tinted bubble but
             quieter (subtle border + card bg), so the assistant turn
             reads as a "speaker" without competing for attention. */
          <div className="rounded-2xl border border-subtle bg-card px-4 py-3">
            <div className="markdown-body text-[15px] leading-7">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize, rehypeHighlight]}
              >
                {content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="ml-0.5 inline-block h-[18px] w-[2px] -mb-1 animate-blink bg-accent/80 align-text-bottom" />
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
  // exactOptionalPropertyTypes (#657)
  toolCallId?: string | undefined;
}) {
  const isRejection = content.startsWith("User rejected execution");

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={messageTransition}
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

