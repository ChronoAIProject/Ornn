/**
 * Chat Message Component for Generative Mode.
 * Renders user/assistant message bubbles with streaming and completion states.
 * @module components/skill/GenerationChatMessage
 */

import { motion } from "framer-motion";
import type { ChatDisplayMessage } from "@/hooks/useSkillGeneration";

export interface GenerationChatMessageProps {
  message: ChatDisplayMessage;
}

const messageVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export function GenerationChatMessage({ message }: GenerationChatMessageProps) {
  if (message.role === "user") {
    return <UserBubble content={message.content} />;
  }

  if (message.content.startsWith("Error:")) {
    return <ErrorBubble content={message.content} />;
  }

  if (message.isStreaming) {
    return <StreamingBubble content={message.content} />;
  }

  return (
    <CompleteBubble
      content={message.content}
      skillName={message.skillName}
      skillDescription={message.skillDescription}
    />
  );
}

function UserBubble({ content }: { content: string }) {
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

function StreamingBubble({ content }: { content: string }) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div className="bg-card max-w-[85%] rounded rounded-bl-sm px-4 py-3">
        {content ? (
          <pre className="whitespace-pre-wrap font-mono text-xs text-strong/80">
            {content}
            <span className="inline-block h-4 w-1.5 animate-blink bg-accent/80" />
          </pre>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-warning border-t-transparent" />
            <span className="font-text text-xs text-meta">Generating...</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function CompleteBubble({
  content,
  skillName,
  skillDescription,
}: {
  content: string;
  skillName?: string;
  skillDescription?: string;
}) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div className="bg-card max-w-[85%] rounded rounded-bl-sm px-4 py-3">
        {skillName ? (
          <div className="space-y-1">
            <p className="font-text text-sm text-strong">
              Generated: <span className="font-semibold text-success">{skillName}</span>
            </p>
            {skillDescription && (
              <p className="font-text text-xs text-meta">{skillDescription}</p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-text text-sm text-strong">
            {content}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex justify-start"
    >
      <div className="max-w-[85%] rounded rounded-bl-sm border border-danger/30 bg-danger/5 px-4 py-3">
        <p className="font-text text-sm text-danger">{content.replace(/^Error:\s*/, "")}</p>
      </div>
    </motion.div>
  );
}
