/**
 * MasterPromptEditor — the skillset master prompt (#978) editor.
 *
 * Composes the shared `MarkdownEditor` and layers the skillset-specific
 * contract on top: the body is REQUIRED (trimmed 1–8000 chars), with a live
 * character count and an over-limit / empty warning. Stored opaque on the
 * backend; this is a long-form operating manual telling an agent HOW to use
 * the set (orchestration, ordering, when to pick which member).
 *
 * @module components/skillset/MasterPromptEditor
 */

import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "@/components/form/MarkdownEditor";
import { SKILLSET_INSTRUCTIONS_MAX } from "@/types/skillset";

export interface MasterPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** External validation error (e.g. surfaced on submit). */
  error?: string | undefined;
  className?: string | undefined;
}

/**
 * Validate a master-prompt body against the #978 contract. Returns `null` when
 * valid, else a reason key. Trim-then-bound so whitespace-only never satisfies
 * the non-empty requirement.
 */
export function validateMasterPrompt(value: string): "empty" | "tooLong" | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > SKILLSET_INSTRUCTIONS_MAX) return "tooLong";
  return null;
}

export function MasterPromptEditor({
  value,
  onChange,
  error,
  className = "",
}: MasterPromptEditorProps) {
  const { t } = useTranslation();
  const trimmedLength = value.trim().length;
  const over = trimmedLength > SKILLSET_INSTRUCTIONS_MAX;
  const empty = trimmedLength === 0;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
          {t("skillsetPrompt.label", "Master prompt")}
          <span className="ml-1 text-danger">*</span>
        </label>
        <span
          className={`font-mono text-[10px] ${over ? "text-danger" : "text-meta"}`}
          aria-live="polite"
        >
          {t("skillsetPrompt.count", "{{count}} / {{max}}", {
            count: trimmedLength,
            max: SKILLSET_INSTRUCTIONS_MAX,
          })}
        </span>
      </div>

      <p className="font-text text-xs text-meta">
        {t(
          "skillsetPrompt.help",
          "Required. Tell an agent how to use this set — orchestration, ordering, and when to pick which member.",
        )}
      </p>

      <MarkdownEditor
        value={value}
        onChange={onChange}
        placeholder={
          t("skillsetPrompt.placeholder", "# How to use this set\n\n1. Start with ...") as string
        }
        minRows={8}
        maxRows={24}
      />

      {over && (
        <p className="font-mono text-[11px] text-danger" role="alert">
          {t("skillsetPrompt.errorTooLong", "Master prompt must be at most {{max}} characters.", {
            max: SKILLSET_INSTRUCTIONS_MAX,
          })}
        </p>
      )}
      {!over && empty && error && (
        <p className="font-mono text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
