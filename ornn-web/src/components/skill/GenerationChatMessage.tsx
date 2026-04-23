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
      <div className="max-w-[80%] rounded-xl rounded-br-sm border border-neon-cyan/30 bg-neon-cyan/5 px-4 py-3">
        <p className="whitespace-pre-wrap font-body text-sm text-text-primary">
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
      <div className="glass max-w-[85%] rounded-xl rounded-bl-sm px-4 py-3">
        {content ? (
          <pre className="whitespace-pre-wrap font-mono text-xs text-text-primary/80">
            {content}
            <span className="inline-block h-4 w-1.5 animate-blink bg-neon-cyan/80" />
          </pre>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neon-yellow border-t-transparent" />
            <span className="font-body text-xs text-text-muted">Generating...</span>
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
      <div className="glass max-w-[85%] rounded-xl rounded-bl-sm px-4 py-3">
        {skillName ? (
          <div className="space-y-1">
            <p className="font-body text-sm text-text-primary">
              Generated: <span className="font-semibold text-neon-green">{skillName}</span>
            </p>
            {skillDescription && (
              <p className="font-body text-xs text-text-muted">{skillDescription}</p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-body text-sm text-text-primary">
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
      <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-neon-red/30 bg-neon-red/5 px-4 py-3">
        <p className="font-body text-sm text-neon-red">{content.replace(/^Error:\s*/, "")}</p>
      </div>
    </motion.div>
  );
}
