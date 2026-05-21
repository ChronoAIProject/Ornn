/**
 * TagInput — multi-value tag input with a soft duplicate guard.
 *
 * Used by SkillForm + the Guided-create StepBasicInfo to collect
 * `metadata.tag` entries. Tags are normalized to `trim().toLowerCase()`
 * before insertion so casing + whitespace differences don't slip through
 * the dup check.
 *
 * #650 / #653 — on Enter (or `,`) with a duplicate, the input was
 * silently rejected: no error and the rejected text stayed in the
 * field. Typing the next tag concatenated onto the stale value
 * (`alpha` → `alpha` rejected → `beta` typed → result `alphabeta`).
 * Fixed by:
 *   1. Clearing the input on duplicate (nothing to fix — the existing
 *      tag is already valid), matching the success path.
 *   2. Surfacing a transient `Already added` error below the field,
 *      mirroring `MultiValueInput`'s feedback wording so the two
 *      multi-value inputs read the same.
 * The error clears on the next keystroke so it never blocks typing.
 *
 * @module components/form/TagInput
 */
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
  // exactOptionalPropertyTypes (#657)
  error?: string | undefined;
  className?: string | undefined;
}

export function TagInput({ tags, onChange, error, className = "" }: TagInputProps) {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const addTag = useCallback(
    (value: string) => {
      const trimmed = value.trim().toLowerCase();
      // Empty after trim — silently swallow; nothing to flag, the user
      // just pressed Enter on whitespace.
      if (!trimmed) {
        setInput("");
        return;
      }
      // Max guard is also enforced by the disabled input below, but keep
      // a defensive branch in case the prop is wired to bypass the UI
      // (e.g. paste-then-Enter while at the cap).
      if (tags.length >= MAX_TAGS) {
        setInputError(`Maximum ${MAX_TAGS} tags`);
        setInput("");
        return;
      }
      if (tags.includes(trimmed)) {
        // #650 + #653 — surface the rejection AND clear the input so
        // the next keystroke doesn't concatenate onto the stale value.
        setInputError("Already added");
        setInput("");
        return;
      }
      setInputError(null);
      onChange([...tags, trimmed]);
      setInput("");
    },
    [tags, onChange],
  );

  const removeTag = useCallback(
    (tag: string) => {
      setInputError(null);
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]!);
    }
  };

  // Prefer the live transient error (`inputError`) over the form-level
  // `error` prop so the user sees feedback for the action they just
  // took, not a stale parent-level message.
  const displayError = inputError ?? error;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-display text-xs uppercase tracking-wider text-meta">
        Tags ({tags.length}/{MAX_TAGS})
      </label>
      <div className="neon-input flex flex-wrap gap-1.5 rounded px-3 py-2">
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
          onChange={(e) => {
            setInput(e.target.value);
            // Any keystroke means the user is acting on the feedback;
            // drop the transient error so it doesn't linger.
            if (inputError) setInputError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={tags.length < MAX_TAGS ? "Type + Enter" : "Max tags reached"}
          disabled={tags.length >= MAX_TAGS}
          className="min-w-[100px] flex-1 border-none bg-transparent font-text text-sm text-strong outline-none placeholder:text-meta/50"
        />
      </div>
      {displayError && <span className="text-xs text-danger">{displayError}</span>}
    </div>
  );
}
