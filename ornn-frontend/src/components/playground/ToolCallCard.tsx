/**
 * Tool Call Card Component.
 * Displays a tool call within the conversation with status-dependent styling.
 * @module components/playground/ToolCallCard
 */

import { motion } from "framer-motion";
import { ToolIcon } from "./PlaygroundIcons";
import type { ToolCall, ToolCallStatus } from "@/types/playground";

export interface ToolCallCardProps {
  toolCall: ToolCall;
  status: ToolCallStatus;
}

/** Color and styling configuration per tool call status. */
const STATUS_STYLES: Record<
  ToolCallStatus,
  { border: string; badge: string; label: string }
> = {
  pending: {
    border: "border-neon-yellow/40 animate-pulse",
    badge: "bg-neon-yellow/10 text-neon-yellow",
    label: "Pending Approval",
  },
  approved: {
    border: "border-neon-cyan/40",
    badge: "bg-neon-cyan/10 text-neon-cyan",
    label: "Approved",
  },
  executing: {
    border: "border-neon-cyan/40",
    badge: "bg-neon-cyan/10 text-neon-cyan",
    label: "Executing...",
  },
  completed: {
    border: "border-neon-green/40",
    badge: "bg-neon-green/10 text-neon-green",
    label: "Completed",
  },
  rejected: {
    border: "border-neon-red/40",
    badge: "bg-neon-red/10 text-neon-red",
    label: "Rejected",
  },
  error: {
    border: "border-neon-red/40",
    badge: "bg-neon-red/10 text-neon-red",
    label: "Error",
  },
};

/** Format tool arguments as readable JSON. */
function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function ToolCallCard({ toolCall, status }: ToolCallCardProps) {
  const style = STATUS_STYLES[status];
  const isAutoExecute = toolCall.name === "skill_search";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-lg border bg-bg-surface/50 p-3 ${style.border}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <ToolIcon className="h-4 w-4 text-text-muted" />
        <span className="font-heading text-xs uppercase tracking-wider text-text-primary">
          {toolCall.name}
        </span>

        {/* Status badge */}
        <span
          className={`ml-auto rounded-full px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${style.badge}`}
        >
          {isAutoExecute ? "Auto-executed" : style.label}
        </span>
      </div>

      {/* Arguments */}
      {Object.keys(toolCall.args).length > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-bg-deep/60 p-2 font-mono text-xs text-text-muted">
          {formatArgs(toolCall.args)}
        </pre>
      )}
    </motion.div>
  );
}

