/**
 * SkillsetMemberPicker — add/remove member skill refs for a skillset.
 *
 * A skill typeahead (`searchSkills`) feeds a ref builder: pick a skill, the
 * picker appends a `name@<latest-major.minor>` ref (the version defaults to
 * the skill's `latestVersion` when known, else `latest`). The author can also
 * type a raw ref (`name@1.0` / `name@tag`) and press Enter.
 *
 * Client-side rejections mirror the backend v1 rules:
 *   - `skillset:`-prefixed refs (no nested skillsets)
 *   - a ref pointing at the skillset being edited (a set can't contain itself)
 *   - empty / duplicate refs
 *
 * Members render as removable chips. The 2–100 count bound is enforced at the
 * form level (publish disabled out of range) and surfaced here as a count hint.
 *
 * @module components/skillset/SkillsetMemberPicker
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
import { useDebounce } from "@/hooks/useDebounce";
import {
  SKILLSET_MAX_MEMBERS,
  SKILLSET_MIN_MEMBERS,
  parseMemberRef,
  rejectMemberRef,
} from "@/types/skillset";

export interface SkillsetMemberPickerProps {
  /** Current member refs (controlled). */
  members: string[];
  onChange: (next: string[]) => void;
  /** Name of the skillset being edited — refs pointing at it are rejected. */
  selfName?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
}

export function SkillsetMemberPicker({
  members,
  onChange,
  selfName,
  error,
  className = "",
}: SkillsetMemberPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebounce(query.trim(), 200);
  const { data: results } = useQuery({
    queryKey: ["skillset-member-search", debounced],
    queryFn: () =>
      searchSkills({ query: debounced, mode: "keyword", scope: "public", pageSize: 8 }),
    enabled: focused && debounced.length > 0,
    staleTime: 10_000,
  });
  const suggestions = results?.items ?? [];

  function tryAdd(ref: string) {
    const trimmed = ref.trim();
    const rejection = rejectMemberRef(trimmed, selfName);
    if (rejection === "empty") {
      setLocalError(t("skillsetMembers.errorEmpty", "Enter a skill ref."));
      return;
    }
    if (rejection === "nested") {
      setLocalError(
        t(
          "skillsetMembers.errorNested",
          "A skillset cannot reference another skillset. Remove the skillset: prefix.",
        ),
      );
      return;
    }
    if (rejection === "self") {
      setLocalError(
        t("skillsetMembers.errorSelf", "A skillset cannot include itself as a member."),
      );
      return;
    }
    if (rejection === "noversion") {
      setLocalError(
        t("skillsetMembers.errorNoVersion", "Include a version, e.g. name@1.0."),
      );
      return;
    }
    if (members.includes(trimmed)) {
      setLocalError(t("skillsetMembers.errorDuplicate", "That member is already added."));
      return;
    }
    if (members.length >= SKILLSET_MAX_MEMBERS) {
      setLocalError(
        t("skillsetMembers.errorMax", "A skillset may have at most {{max}} members.", {
          max: SKILLSET_MAX_MEMBERS,
        }),
      );
      return;
    }
    setLocalError(null);
    onChange([...members, trimmed]);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }

  function addFromSkill(name: string, latestVersion?: string) {
    const version = latestVersion && latestVersion.length > 0 ? latestVersion : "latest";
    tryAdd(`${name}@${version}`);
  }

  function removeMember(ref: string) {
    onChange(members.filter((m) => m !== ref));
  }

  const count = members.length;
  const belowMin = count < SKILLSET_MIN_MEMBERS;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
          {t("skillsetMembers.label", "Members")}
        </label>
        <span
          className={`font-mono text-[10px] ${belowMin ? "text-warning" : "text-meta"}`}
          aria-live="polite"
        >
          {t("skillsetMembers.count", "{{count}} / {{max}}", {
            count,
            max: SKILLSET_MAX_MEMBERS,
          })}
        </span>
      </div>

      {/* Chips. */}
      <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
        {members.length === 0 && (
          <p className="font-text text-xs text-meta italic w-full">
            {t("skillsetMembers.empty", "No members yet. Add at least {{min}} skills.", {
              min: SKILLSET_MIN_MEMBERS,
            })}
          </p>
        )}
        {members.map((ref) => {
          const { name, version } = parseMemberRef(ref);
          return (
            <span
              key={ref}
              className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-2 py-1 font-mono text-xs text-strong h-fit"
            >
              <span className="truncate max-w-[16rem]">
                {name}
                {version && <span className="text-meta">@{version}</span>}
              </span>
              <button
                type="button"
                onClick={() => removeMember(ref)}
                className="text-danger hover:text-danger/80 cursor-pointer"
                aria-label={t("skillsetMembers.remove", "Remove {{ref}}", { ref })}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {/* Typeahead + raw-ref entry. */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (localError) setLocalError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              tryAdd(query);
            }
          }}
          placeholder={
            t("skillsetMembers.placeholder", "search a skill, or type name@1.0 then Enter") as string
          }
          className="w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-text text-sm text-strong placeholder:text-meta/70 focus:border-accent focus:bg-card focus:outline-none"
        />
        {focused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-52 overflow-y-auto rounded-sm border border-subtle bg-card card-impression">
            {suggestions.map((s) => (
              <button
                key={s.guid}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addFromSkill(s.name);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-text text-sm hover:bg-accent/10 cursor-pointer"
              >
                <span className="truncate text-strong">{s.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-meta">
                  {s.isPrivate
                    ? t("common.private")
                    : t("common.public")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {(localError || error) && (
        <p className="font-mono text-[11px] text-danger" role="alert">
          {localError ?? error}
        </p>
      )}
    </div>
  );
}
