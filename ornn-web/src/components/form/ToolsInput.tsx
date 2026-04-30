/**
 * Tools Input Component.
 * Tag-style free-text input for Claude tool names with suggested tools.
 * @module components/form/ToolsInput
 */

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { SUGGESTED_TOOLS } from "@/utils/constants";

export interface ToolsInputProps {
  tools: string[];
  onChange: (tools: string[]) => void;
  error?: string;
  className?: string;
}

export function ToolsInput({ tools, onChange, error, className = "" }: ToolsInputProps) {
  const [input, setInput] = useState("");

  const addTool = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || tools.includes(trimmed)) return;
      onChange([...tools, trimmed]);
      setInput("");
    },
    [tools, onChange],
  );

  const removeTool = useCallback(
    (tool: string) => onChange(tools.filter((t) => t !== tool)),
    [tools, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTool(input);
    }
    if (e.key === "Backspace" && !input && tools.length > 0) {
      removeTool(tools[tools.length - 1]);
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-display text-xs uppercase tracking-wider text-meta">
        Required Tools
      </label>

      {/* Input with tag chips */}
      <div className="neon-input flex flex-wrap gap-1.5 rounded px-3 py-2">
        {tools.map((tool) => (
          <Badge key={tool} color="cyan">
            {tool}
            <button
              type="button"
              onClick={() => removeTool(tool)}
              className="ml-1 text-inherit opacity-60 hover:opacity-100"
            >
              x
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a tool name + Enter"
          className="min-w-[100px] flex-1 border-none bg-transparent font-text text-sm text-strong outline-none placeholder:text-meta/50"
        />
      </div>

      {/* Suggested tools */}
      <div className="flex flex-wrap gap-1.5 mt-1">
        <span className="text-xs text-meta font-text mr-1 self-center">
          Suggested:
        </span>
        {SUGGESTED_TOOLS.map((tool) => {
          const isAdded = tools.includes(tool);
          return (
            <button
              key={tool}
              type="button"
              onClick={() => !isAdded && addTool(tool)}
              disabled={isAdded}
              className="cursor-pointer disabled:cursor-default"
            >
              <Badge color={isAdded ? "cyan" : "muted"}>
                {tool}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Warning banner */}
      <div className="rounded border border-warning/20 bg-warning/5 p-3 mt-1">
        <p className="font-text text-xs text-warning">
          Ensure that the tools you list are available in your target Claude client
          environment. Skills referencing unavailable tools will fail at runtime.
        </p>
      </div>

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
