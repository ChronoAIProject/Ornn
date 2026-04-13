import { useState, useCallback } from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { MAX_TAGS } from "@/utils/constants";

/** Rotating color palette for tag badges */
const TAG_COLORS: BadgeProps["color"][] = ["cyan", "magenta", "yellow", "green"];

/** Deterministic color for a tag based on its characters */
function getTagColor(tag: string): BadgeProps["color"] {
  const hash = tag.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return TAG_COLORS[hash % TAG_COLORS.length];
}

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  error?: string;
  className?: string;
}

export function TagInput({ tags, onChange, error, className = "" }: TagInputProps) {
  const [input, setInput] = useState("");

  const addTag = useCallback(
    (value: string) => {
      const trimmed = value.trim().toLowerCase();
      if (!trimmed || tags.includes(trimmed) || tags.length >= MAX_TAGS) return;
      onChange([...tags, trimmed]);
      setInput("");
    },
    [tags, onChange]
  );

  const removeTag = useCallback(
    (tag: string) => onChange(tags.filter((t) => t !== tag)),
    [tags, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-heading text-xs uppercase tracking-wider text-text-muted">
        Tags ({tags.length}/{MAX_TAGS})
      </label>
      <div className="neon-input flex flex-wrap gap-1.5 rounded-lg px-3 py-2">
        {tags.map((tag) => (
          <Badge key={tag} color={getTagColor(tag)}>
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
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
          placeholder={tags.length < MAX_TAGS ? "Type + Enter" : "Max tags reached"}
          disabled={tags.length >= MAX_TAGS}
          className="min-w-[100px] flex-1 border-none bg-transparent font-body text-sm text-text-primary outline-none placeholder:text-text-muted/50"
        />
      </div>
      {error && <span className="text-xs text-neon-red">{error}</span>}
    </div>
  );
}
