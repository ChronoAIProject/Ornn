/**
 * Chat Message Component for Generative Mode.
 *
 * Visual language matches `components/playground/ChatMessage` so the two
 * LLM surfaces feel like one product:
 *   - User bubble:   ember-tinted (`bg-warning-soft` + `border-accent/30`).
 *   - Assistant bubble: cool (`bg-card` + `border-subtle`).
 *   - Both: `rounded-2xl`, 15px / leading-7.
 *   - Spring entrance: opacity + tiny rise + 98→100% scale, low-stiffness
 *     spring so each new turn lands softly without distracting.
 *
 * @module components/skill/GenerationChatMessage
 */

import { motion } from "framer-motion";
import type { ChatDisplayMessage } from "@/hooks/useSkillGeneration";

export interface GenerationChatMessageProps {
  message: ChatDisplayMessage;
}

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
      transition={messageTransition}
      className="flex justify-end"
    >
      <div className="max-w-[80%] rounded-2xl border border-accent/30 bg-warning-soft px-4 py-2.5">
        <p className="whitespace-pre-wrap font-text text-[15px] leading-7 text-strong">
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
      transition={messageTransition}
      className="flex justify-start"
    >
      <div className="max-w-[88%] rounded-2xl border border-subtle bg-card px-4 py-3">
        {content ? (
          /* Structured generation output (JSON + file contents) — keep
             monospace + smaller font so multi-file streams remain
             scannable; the generative artifact isn't free prose. */
          <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-strong/85">
            {content}
            <span className="ml-0.5 inline-block h-[14px] w-[2px] -mb-0.5 animate-blink bg-accent/80 align-text-bottom" />
          </pre>
        ) : (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "300ms" }} />
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
  // exactOptionalPropertyTypes (#657)
  skillName?: string | undefined;
  skillDescription?: string | undefined;
}) {
  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={messageTransition}
      className="flex justify-start"
    >
      <div className="max-w-[88%] rounded-2xl border border-subtle bg-card px-4 py-3">
        {skillName ? (
          <div className="space-y-1">
            <p className="font-text text-[15px] leading-7 text-strong">
              Generated:{" "}
              <span className="font-semibold text-success">{skillName}</span>
            </p>
            {skillDescription && (
              <p className="font-text text-[13px] leading-6 text-meta">
                {skillDescription}
              </p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-text text-[15px] leading-7 text-strong">
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
      transition={messageTransition}
      className="flex justify-start"
    >
      <div className="max-w-[88%] rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3">
        <p className="font-text text-[15px] leading-7 text-danger">
          {content.replace(/^Error:\s*/, "")}
        </p>
      </div>
    </motion.div>
  );
}
