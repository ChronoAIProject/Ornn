/**
 * SkillsetMemberPicker — add/remove member skill refs for a skillset.
 *
 * Skill-explorer UI: scope tabs (All / System / Public / My Skills / Shared)
 * let the user browse discoverable skills, with a search input to filter.
 * Clicking a skill card expands it to show published versions; clicking a
 * version adds `name@version` as a member.  Already-added members render as
 * removable chips above the explorer.
 *
 * Raw entry of `name@1.0` in the search bar + Enter is still supported for
 * power users.
 *
 * Client-side rejections mirror the backend v1 rules:
 *   - `skillset:`-prefixed refs (no nested skillsets)
 *   - a ref pointing at the skillset being edited (a set can't contain itself)
 *   - empty / duplicate refs
 *   - (raw path) missing version after @
 *
 * Members render as removable chips. The 2–100 count bound is enforced at the
 * form level (publish disabled out of range) and surfaced here as a count hint.
 *
 * @module components/skillset/SkillsetMemberPicker
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
import { useDebounce } from "@/hooks/useDebounce";
import { useSkillVersions } from "@/hooks/useSkills";
import type { SkillSearchResult, SkillScope, SystemFilter } from "@/types/search";
import {
  SKILLSET_MAX_MEMBERS,
  SKILLSET_MIN_MEMBERS,
  parseMemberRef,
  rejectMemberRef,
} from "@/types/skillset";

// ---------------------------------------------------------------------------
// Scope tab definition
// ---------------------------------------------------------------------------

type ExplorerTab = "all" | "system" | "public" | "mine" | "shared";

const TAB_DEFS: { key: ExplorerTab; scope: SkillScope; systemFilter: SystemFilter }[] = [
  { key: "all", scope: "mixed", systemFilter: "any" },
  { key: "system", scope: "mixed", systemFilter: "only" },
  { key: "public", scope: "public", systemFilter: "exclude" },
  { key: "mine", scope: "mine", systemFilter: "exclude" },
  { key: "shared", scope: "shared-with-me", systemFilter: "exclude" },
];

// ---------------------------------------------------------------------------
// Visibility badge for a skill card
// ---------------------------------------------------------------------------

function VisibilityBadge({ skill }: { skill: SkillSearchResult }) {
  const { t } = useTranslation();
  if (skill.isSystemSkill) {
    return (
      <span className="rounded-sm border border-accent-support/40 bg-accent-support/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-accent-support">
        {t("skillsetMembers.systemBadge", "system")}
      </span>
    );
  }
  if (skill.isPrivate) {
    return (
      <span className="rounded-sm border border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-meta">
        {t("skillsetMembers.privateBadge", "private")}
      </span>
    );
  }
  return (
    <span className="rounded-sm border border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-meta">
      {t("skillsetMembers.publicBadge", "public")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
  const [activeTab, setActiveTab] = useState<ExplorerTab>("all");
  const [localError, setLocalError] = useState<string | null>(null);
  /** Skill name whose versions are currently expanded. */
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const debounced = useDebounce(query.trim(), 200);
  const tabDef = TAB_DEFS.find((d) => d.key === activeTab)!;

  // Fetch skills for the active scope + search query.
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["skillset-explorer", debounced, tabDef.scope, tabDef.systemFilter],
    queryFn: () =>
      searchSkills({
        query: debounced || undefined,
        mode: "keyword",
        scope: tabDef.scope,
        systemFilter: tabDef.systemFilter,
        pageSize: 20,
      }),
    staleTime: 10_000,
  });
  const skills = searchResults?.items ?? [];

  // Versions for the expanded skill.
  const versionsQ = useSkillVersions(expandedSkill ?? "");
  const skillVersions = versionsQ.data ?? [];
  const versionsLoading = versionsQ.isLoading;

  // Member set for quick lookup (already-added check).
  const memberSet = new Set(members);

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
    setExpandedSkill(null);
  }

  function removeMember(ref: string) {
    onChange(members.filter((m) => m !== ref));
  }

  const count = members.length;
  const belowMin = count < SKILLSET_MIN_MEMBERS;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header row */}
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

      {/* Added members as chips */}
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

      {/* Explorer panel */}
      <div className="rounded-sm border border-subtle bg-elevated/30 overflow-hidden">
        {/* Search input */}
        <div className="border-b border-subtle px-3 py-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (localError) setLocalError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Allow raw name@version entry via Enter.
                if (query.includes("@")) {
                  tryAdd(query);
                }
              }
            }}
            placeholder={
              t(
                "skillsetMembers.explorerPlaceholder",
                "Search skills… or type name@1.0 and press Enter",
              ) as string
            }
            className="w-full rounded-sm border border-subtle bg-card px-3 py-1.5 font-text text-sm text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none"
          />
        </div>

        {/* Scope tabs */}
        <div className="flex gap-1 border-b border-subtle px-3 py-1.5">
          {TAB_DEFS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setExpandedSkill(null);
              }}
              className={`rounded-sm px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "text-meta hover:text-strong border border-transparent"
              }`}
            >
              {t(`skillsetMembers.tab.${tab.key}`, tab.key === "mine" ? "My Skills" : tab.key.charAt(0).toUpperCase() + tab.key.slice(1))}
            </button>
          ))}
        </div>

        {/* Skill list */}
        <div className="max-h-[340px] overflow-y-auto">
          {searchLoading && (
            <p className="px-4 py-3 font-text text-sm text-meta italic">
              {t("skillsetMembers.loading", "Loading skills…")}
            </p>
          )}
          {!searchLoading && skills.length === 0 && (
            <p className="px-4 py-3 font-text text-sm text-meta italic">
              {debounced
                ? t("skillsetMembers.noResults", "No skills match your search.")
                : t("skillsetMembers.noSkills", "No skills found in this category.")}
            </p>
          )}
          {skills.map((skill) => {
            const isExpanded = expandedSkill === skill.name;
            const allVersionsAdded = isExpanded && skillVersions.length > 0 && skillVersions.every((v) => memberSet.has(`${skill.name}@${v.version}`));

            return (
              <div key={skill.guid} className="border-b border-subtle last:border-b-0">
                {/* Skill card header */}
                <button
                  type="button"
                  onClick={() => {
                    if (isExpanded) {
                      setExpandedSkill(null);
                    } else {
                      setExpandedSkill(skill.name);
                    }
                  }}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/5 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold text-strong">
                        {skill.name}
                      </span>
                      <VisibilityBadge skill={skill} />
                    </div>
                    {skill.description && (
                      <p className="mt-0.5 truncate font-text text-[12px] leading-snug text-body">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-meta transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                    ▸
                  </span>
                </button>

                {/* Expanded version rows */}
                {isExpanded && (
                  <div className="border-t border-subtle bg-elevated/40">
                    {versionsLoading ? (
                      <p className="px-6 py-2 font-text text-[11px] text-meta italic">
                        {t("skillsetMembers.loadingVersions", "Loading versions…")}
                      </p>
                    ) : skillVersions.length === 0 ? (
                      <p className="px-6 py-2 font-text text-[11px] text-meta italic">
                        {t("skillsetMembers.noVersions", "No published versions found for this skill.")}
                      </p>
                    ) : allVersionsAdded ? (
                      <p className="px-6 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-meta">
                        {t("skillsetMembers.allAdded", "All versions already added")}
                      </p>
                    ) : (
                      skillVersions.slice(0, 10).map((v) => {
                        const isLatest = v.version === skillVersions[0]?.version;
                        const ref = `${skill.name}@${v.version}`;
                        const alreadyAdded = memberSet.has(ref);
                        return (
                          <div
                            key={v.version}
                            className="flex items-center gap-2 px-6 py-1.5 hover:bg-accent/5"
                          >
                            <span className="font-mono text-[12px] text-strong">
                              {v.version}
                            </span>
                            {isLatest && (
                              <span className="rounded-sm border border-accent/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent">
                                {t("skillDetail.latest", "latest")}
                              </span>
                            )}
                            {v.isDeprecated && (
                              <span className="rounded-sm border border-warning/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-warning">
                                {t("common.deprecated", "deprecated")}
                              </span>
                            )}
                            <span className="ml-auto">
                              {alreadyAdded ? (
                                <span className="font-mono text-[10px] text-meta">
                                  ✓ {t("skillsetMembers.added", "added")}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => tryAdd(ref)}
                                  className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent transition-colors hover:bg-accent/20 cursor-pointer"
                                >
                                  + {t("skillsetMembers.add", "Add")}
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {(localError || error) && (
        <p className="font-mono text-[11px] text-danger" role="alert">
          {localError ?? error}
        </p>
      )}
    </div>
  );
}
