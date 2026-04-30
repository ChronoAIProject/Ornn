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
    border: "border-warning/40 animate-pulse",
    badge: "bg-warning/10 text-warning",
    label: "Pending Approval",
  },
  approved: {
    border: "border-accent/40",
    badge: "bg-accent/10 text-accent",
    label: "Approved",
  },
  executing: {
    border: "border-accent/40",
    badge: "bg-accent/10 text-accent",
    label: "Executing...",
  },
  completed: {
    border: "border-success/40",
    badge: "bg-success/10 text-success",
    label: "Completed",
  },
  rejected: {
    border: "border-danger/40",
    badge: "bg-danger/10 text-danger",
    label: "Rejected",
  },
  error: {
    border: "border-danger/40",
    badge: "bg-danger/10 text-danger",
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
      className={`rounded border bg-card/50 p-3 ${style.border}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <ToolIcon className="h-4 w-4 text-meta" />
        <span className="font-display text-xs uppercase tracking-wider text-strong">
          {toolCall.name}
        </span>

        {/* Status badge */}
        <span
          className={`ml-auto rounded-full px-2 py-0.5 font-display text-[10px] uppercase tracking-wider ${style.badge}`}
        >
          {isAutoExecute ? "Auto-executed" : style.label}
        </span>
      </div>

      {/* Arguments */}
      {Object.keys(toolCall.args).length > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-page/60 p-2 font-mono text-xs text-meta">
          {formatArgs(toolCall.args)}
        </pre>
      )}
    </motion.div>
  );
}

