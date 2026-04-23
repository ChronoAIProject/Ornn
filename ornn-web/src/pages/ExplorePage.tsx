/**
 * ExplorePage — the skill registry.
 *
 * Three mutually-exclusive tabs filter the same skill search endpoint
 * by scope. Tab counts come from /api/v1/skills/counts in a single
 * round-trip. The System-skill control is a tri-state filter (not a
 * tab) so a user can ask "what do I have wired to my NyxID services?"
 * within any tab.
 *
 * All visible state is URL-encoded via useSearchParams so a registry
 * view can be copy-pasted between tabs/people.
 */

import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { SearchBar } from "@/components/search/SearchBar";
import { SkillCard } from "@/components/skill/SkillCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useSearchStore } from "@/stores/searchStore";
import {
  useSkills,
  useMySkills,
  useSharedWithMeSkills,
  useSkillCounts,
} from "@/hooks/useSkills";
import { useMySkillGrantsSummary, useSharedSkillSources } from "@/hooks/useMe";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import type { SystemFilter } from "@/types/search";

type ExploreTab = "public" | "my-skills" | "shared-with-me";

const DEFAULT_PAGE_SIZE = 20;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

/** Parse the `?tab=` query param into a concrete tab value, defaulting to "public". */
function parseTab(raw: string | null, authed: boolean): ExploreTab {
  if (!authed) return "public";
  if (raw === "my-skills" || raw === "shared-with-me") return raw;
  return "public";
}

function parseSystemFilter(raw: string | null): SystemFilter {
  return raw === "only" || raw === "exclude" ? raw : "any";
}

/** Parse a comma-joined URL param into a de-duped id list. */
function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(parts)];
}

export function ExplorePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  const activeTab = parseTab(searchParams.get("tab"), isAuthenticated);
  const systemFilter = parseSystemFilter(searchParams.get("sys"));
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const activePage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // Chip-row filter state is held in the URL so the whole view is
  // replayable: `orgs=` / `users=` on My Skills, `srcOrgs=` / `srcUsers=`
  // on Shared-with-me. Empty arrays mean no filter.
  const selectedGrantOrgs = parseCsvParam(searchParams.get("orgs"));
  const selectedGrantUsers = parseCsvParam(searchParams.get("users"));
  const selectedSourceOrgs = parseCsvParam(searchParams.get("srcOrgs"));
  const selectedSourceUsers = parseCsvParam(searchParams.get("srcUsers"));

  // Query + mode still live in the global search store (shared with the
  // search bar). Page lives in the URL so tab switches preserve pagination
  // cleanly per tab identity.
  const { query, mode } = useSearchStore();

  const { data: publicData, isLoading: publicLoading } = useSkills({
    query: query || undefined,
    mode,
    page: activeTab === "public" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    systemFilter,
    // React Query skips the call-level `enabled` for useQuery derived
    // from hook, but empty renders are cheap. Public always loads; the
    // tab's paging + filter variance is the cache key.
  });

  const { data: mineData, isLoading: mineLoading } = useMySkills({
    query: query || undefined,
    mode,
    page: activeTab === "my-skills" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    systemFilter,
    sharedWithOrgs: selectedGrantOrgs,
    sharedWithUsers: selectedGrantUsers,
  });

  const { data: sharedData, isLoading: sharedLoading } = useSharedWithMeSkills({
    query: query || undefined,
    mode,
    page: activeTab === "shared-with-me" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    systemFilter,
    sharedWithOrgs: selectedSourceOrgs,
    createdByAny: selectedSourceUsers,
    enabled: isAuthenticated,
  });

  const { data: counts } = useSkillCounts();
  const { data: grantsSummary } = useMySkillGrantsSummary();
  const { data: sourcesSummary } = useSharedSkillSources();

  const activeData =
    activeTab === "public" ? publicData : activeTab === "my-skills" ? mineData : sharedData;
  const activeLoading =
    activeTab === "public" ? publicLoading : activeTab === "my-skills" ? mineLoading : sharedLoading;

  const totalPages = activeData?.totalPages ?? 0;

  const items = useMemo(() => activeData?.items ?? [], [activeData]);

  /** Update `?tab=`; reset page to 1 to avoid landing on a page past the new tab's range. */
  function handleTabChange(tab: ExploreTab) {
    const next = new URLSearchParams(searchParams);
    if (tab === "public") next.delete("tab");
    else next.set("tab", tab);
    next.delete("page");
    setSearchParams(next);
  }

  function handleSystemFilterChange(value: SystemFilter) {
    const next = new URLSearchParams(searchParams);
    if (value === "any") next.delete("sys");
    else next.set("sys", value);
    next.delete("page");
    setSearchParams(next);
  }

  function handlePageChange(p: number) {
    const next = new URLSearchParams(searchParams);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    setSearchParams(next);
  }

  /** Toggle a chip value in a URL list param. Clearing the key when empty keeps URLs clean. */
  function toggleListParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    const current = parseCsvParam(next.get(key));
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    if (updated.length === 0) next.delete(key);
    else next.set(key, updated.join(","));
    next.delete("page");
    setSearchParams(next);
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
        {/* Tab selector — equal-width segmented control, centered and
            capped so it doesn't balloon across wide desktops. Inside
            the cap, grid-cols-N splits the strip into identical-width
            slots regardless of label length. */}
        <div className="mb-3 shrink-0 flex justify-center">
          <div
            className={`
              grid rounded-lg border border-neon-cyan/20 bg-bg-elevated p-1 gap-1
              w-full max-w-xl
              ${isAuthenticated ? "grid-cols-3" : "grid-cols-1"}
            `}
          >
            <TabButton
              label={t("explore.publicSkills", "Public")}
              count={counts?.public}
              active={activeTab === "public"}
              onClick={() => handleTabChange("public")}
            />
            {isAuthenticated && (
              <>
                <TabButton
                  label={t("explore.mySkills", "My Skills")}
                  count={counts?.mine}
                  active={activeTab === "my-skills"}
                  onClick={() => handleTabChange("my-skills")}
                />
                <TabButton
                  label={t("explore.sharedWithMe", "Shared with me")}
                  count={counts?.sharedWithMe}
                  active={activeTab === "shared-with-me"}
                  onClick={() => handleTabChange("shared-with-me")}
                />
              </>
            )}
          </div>
        </div>

        {/* Search + system-filter bar */}
        <div className="mb-3 flex flex-wrap gap-3 items-center shrink-0">
          <div className="flex-1 min-w-[220px]">
            <SearchBar />
          </div>
          {isAuthenticated && (
            <SystemFilterControl value={systemFilter} onChange={handleSystemFilterChange} />
          )}
        </div>

        {/* Per-tab chip filter rows — aggregated server-side so the
            chip list is exact, not a snapshot of the current page. */}
        {activeTab === "my-skills" && grantsSummary && (grantsSummary.orgs.length + grantsSummary.users.length > 0) && (
          <div className="mb-3 space-y-2 shrink-0">
            {grantsSummary.orgs.length > 0 && (
              <ChipRow
                label="Shared with orgs"
                items={grantsSummary.orgs.map((o) => ({ id: o.id, label: o.displayName, count: o.skillCount }))}
                selected={selectedGrantOrgs}
                onToggle={(id) => toggleListParam("orgs", id)}
              />
            )}
            {grantsSummary.users.length > 0 && (
              <ChipRow
                label="Shared with users"
                items={grantsSummary.users.map((u) => ({ id: u.userId, label: u.email || u.displayName || u.userId, count: u.skillCount }))}
                selected={selectedGrantUsers}
                onToggle={(id) => toggleListParam("users", id)}
              />
            )}
          </div>
        )}

        {activeTab === "shared-with-me" && sourcesSummary && (sourcesSummary.orgs.length + sourcesSummary.users.length > 0) && (
          <div className="mb-3 space-y-2 shrink-0">
            {sourcesSummary.orgs.length > 0 && (
              <ChipRow
                label="Via organizations"
                items={sourcesSummary.orgs.map((o) => ({ id: o.id, label: o.displayName, count: o.skillCount }))}
                selected={selectedSourceOrgs}
                onToggle={(id) => toggleListParam("srcOrgs", id)}
              />
            )}
            {sourcesSummary.users.length > 0 && (
              <ChipRow
                label="Shared by"
                items={sourcesSummary.users.map((u) => ({ id: u.userId, label: u.email || u.displayName || u.userId, count: u.skillCount }))}
                selected={selectedSourceUsers}
                onToggle={(id) => toggleListParam("srcUsers", id)}
              />
            )}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
          {activeLoading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={emptyTitle(activeTab, t as (k: string, f?: string) => string)}
              description={emptyDescription(activeTab, t as (k: string, f?: string) => string)}
              action={
                activeTab === "my-skills" && isAuthenticated ? (
                  <Button onClick={() => navigate("/skills/new")}>
                    {t("explore.createSkill", "Create a skill")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4"
            >
              {items.map((skill) => (
                <motion.div key={skill.guid} variants={itemVariants}>
                  <SkillCard
                    skill={skill}
                    showOwnerControls={activeTab === "my-skills"}
                    currentUserId={user?.id}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}

          <Pagination page={activePage} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
      </div>
    </PageTransition>
  );
}

interface TabButtonProps {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full px-4 py-2 rounded-md font-body text-sm transition-all cursor-pointer
        inline-flex items-center justify-center gap-2
        ${active
          ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
          : "text-text-muted hover:text-text-primary"}
      `}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`
            px-1.5 py-0.5 rounded font-mono text-[10px]
            ${active ? "bg-neon-cyan/30 text-neon-cyan" : "bg-bg-elevated text-text-muted"}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface SystemFilterControlProps {
  value: SystemFilter;
  onChange: (v: SystemFilter) => void;
}

/**
 * Tri-state System-skill filter rendered as a compact segmented
 * control. Visible only to authenticated users — the detection depends
 * on the caller's NyxID services list, which anonymous callers don't
 * have.
 */
function SystemFilterControl({ value, onChange }: SystemFilterControlProps) {
  const options: Array<{ value: SystemFilter; label: string }> = [
    { value: "any", label: "All" },
    { value: "only", label: "System only" },
    { value: "exclude", label: "Hide system" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-neon-cyan/20 bg-bg-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`
            px-3 py-1.5 rounded-md font-body text-xs transition-all cursor-pointer
            ${value === opt.value
              ? "bg-neon-cyan/20 text-neon-cyan"
              : "text-text-muted hover:text-text-primary"}
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface ChipRowProps {
  label: string;
  items: Array<{ id: string; label: string; count: number }>;
  selected: string[];
  onToggle: (id: string) => void;
}

/**
 * Horizontal row of filter chips. Each chip reads
 * `"<label>  <count>"` and toggles the corresponding id in the tab's
 * URL list param. Multiple chips can be selected at once — the
 * underlying query interprets them with OR semantics.
 */
function ChipRow({ label, items, selected, onToggle }: ChipRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted shrink-0">
        {label}
      </span>
      {items.map((item) => {
        const isOn = selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            className={`
              inline-flex items-center gap-2 px-2.5 py-1 rounded-full border font-body text-xs transition-all cursor-pointer
              ${isOn
                ? "border-neon-cyan/60 bg-neon-cyan/15 text-neon-cyan"
                : "border-neon-cyan/15 bg-bg-elevated text-text-primary hover:border-neon-cyan/40"}
            `}
          >
            <span className="max-w-[180px] truncate">{item.label}</span>
            <span
              className={`
                px-1.5 rounded font-mono text-[10px]
                ${isOn ? "bg-neon-cyan/30" : "bg-bg-base/70 text-text-muted"}
              `}
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function emptyTitle(tab: ExploreTab, t: (key: string, fallback?: string) => string): string {
  if (tab === "public") return t("explore.noSkillsFound", "No public skills match");
  if (tab === "my-skills") return t("explore.noSkillsYet", "You haven't created any skills yet");
  return t("explore.noSharedSkills", "Nothing has been shared with you yet");
}

function emptyDescription(tab: ExploreTab, t: (key: string, fallback?: string) => string): string {
  if (tab === "public") return t("explore.tryAdjusting", "Try adjusting your search or filters.");
  if (tab === "my-skills") return t("explore.createFirst", "Create your first skill to get started.");
  return t(
    "explore.sharedHint",
    "When someone grants you access to a private skill — either directly or via an org — it shows up here.",
  );
}
