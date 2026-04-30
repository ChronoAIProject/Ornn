/**
 * ExplorePage — the skill registry.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  Tabs strip                                   │
 *   ├──────────────────────────────────────────────┤
 *   │  Search bar                                   │
 *   ├──────────────────────────────────────────────┤
 *   │  Sidebar │ Cards grid                         │
 *   │  filters │ + pagination                       │
 *   └──────────┴───────────────────────────────────┘
 *
 * Four tabs, ordered: System · Public · My Skills · Shared with me.
 * Per-tab filter sets live in the sidebar; everything is URL-encoded so a
 * filtered view can be copy-pasted between tabs/people.
 *
 *   System         → `?service=<csv>` (admin NyxID services)
 *   Public         → `?tags=<csv>` + `?authors=<csv>`
 *   My Skills      → `?tags=<csv>` + `?orgs=<csv>` + `?users=<csv>`
 *   Shared with me → `?srcOrgs=<csv>` + `?srcUsers=<csv>`
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
  useSystemSkills,
} from "@/hooks/useSkills";
import {
  useMySkillGrantsSummary,
  useSharedSkillSources,
  useSkillTagFacets,
  useSkillAuthorFacets,
  useSystemServiceFacets,
} from "@/hooks/useMe";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";

type ExploreTab = "system" | "public" | "my-skills" | "shared-with-me";

const DEFAULT_PAGE_SIZE = 20;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

/**
 * Parse the `?tab=` query param into a concrete tab value, defaulting to
 * "system". The `system` and `public` tabs are visible to everyone;
 * `my-skills` and `shared-with-me` require auth.
 */
function parseTab(raw: string | null, authed: boolean): ExploreTab {
  if (raw === "public") return "public";
  if (raw === "system" || raw === null) return raw === null ? "system" : "system";
  if (!authed) return "system";
  if (raw === "my-skills" || raw === "shared-with-me") return raw;
  return "system";
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
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const activePage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // Filter state lives in the URL across tabs:
  //   System         → service (single id)
  //   Public         → tags, authors
  //   My Skills      → tags, orgs (sharedWithOrgs), users (sharedWithUsers)
  //   Shared with me → srcOrgs (sharedWithOrgs), srcUsers (createdByAny)
  const selectedServiceId = searchParams.get("service") || undefined;
  const selectedTags = parseCsvParam(searchParams.get("tags"));
  const selectedAuthors = parseCsvParam(searchParams.get("authors"));
  const selectedGrantOrgs = parseCsvParam(searchParams.get("orgs"));
  const selectedGrantUsers = parseCsvParam(searchParams.get("users"));
  const selectedSourceOrgs = parseCsvParam(searchParams.get("srcOrgs"));
  const selectedSourceUsers = parseCsvParam(searchParams.get("srcUsers"));

  const { query, mode } = useSearchStore();

  const { data: systemData, isLoading: systemLoading } = useSystemSkills({
    query: query || undefined,
    mode,
    page: activeTab === "system" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    nyxidServiceId: selectedServiceId,
  });

  const { data: publicData, isLoading: publicLoading } = useSkills({
    query: query || undefined,
    mode,
    page: activeTab === "public" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    tags: selectedTags,
    createdByAny: selectedAuthors,
  });

  const { data: mineData, isLoading: mineLoading } = useMySkills({
    query: query || undefined,
    mode,
    page: activeTab === "my-skills" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    tags: selectedTags,
    sharedWithOrgs: selectedGrantOrgs,
    sharedWithUsers: selectedGrantUsers,
  });

  const { data: sharedData, isLoading: sharedLoading } = useSharedWithMeSkills({
    query: query || undefined,
    mode,
    page: activeTab === "shared-with-me" ? activePage : 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sharedWithOrgs: selectedSourceOrgs,
    createdByAny: selectedSourceUsers,
    enabled: isAuthenticated,
  });

  const { data: counts } = useSkillCounts();

  const activeData =
    activeTab === "system"
      ? systemData
      : activeTab === "public"
        ? publicData
        : activeTab === "my-skills"
          ? mineData
          : sharedData;
  const activeLoading =
    activeTab === "system"
      ? systemLoading
      : activeTab === "public"
        ? publicLoading
        : activeTab === "my-skills"
          ? mineLoading
          : sharedLoading;

  const totalPages = activeData?.totalPages ?? 0;
  const items = useMemo(() => activeData?.items ?? [], [activeData]);

  /** Update `?tab=`; reset page + per-tab filter params to avoid leaking state. */
  function handleTabChange(tab: ExploreTab) {
    const next = new URLSearchParams();
    if (tab !== "system") next.set("tab", tab);
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

  /** Set a single-value URL param (toggle off when picking the same value). */
  function setSingleParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (!value || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2 gap-3">
        {/* Tabs */}
        <div className="shrink-0 flex justify-center">
          <div
            className={`
              grid rounded-lg border border-accent/20 bg-elevated p-1 gap-1
              w-full max-w-3xl
              ${isAuthenticated ? "grid-cols-4" : "grid-cols-2"}
            `}
          >
            <TabButton
              label={t("explore.systemSkills", "System Skills")}
              count={systemData?.total}
              active={activeTab === "system"}
              onClick={() => handleTabChange("system")}
            />
            <TabButton
              label={t("explore.publicSkills", "Public Skills")}
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

        {/* Search bar (full width, above the 2-col layout) */}
        <div className="shrink-0">
          <SearchBar />
        </div>

        {/* 2-col: filter sidebar + cards */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-4">
          <aside className="lg:w-[280px] shrink-0 lg:overflow-y-auto lg:pr-1">
            <FilterSidebar
              tab={activeTab}
              selectedServiceId={selectedServiceId}
              selectedTags={selectedTags}
              selectedAuthors={selectedAuthors}
              selectedGrantOrgs={selectedGrantOrgs}
              selectedGrantUsers={selectedGrantUsers}
              selectedSourceOrgs={selectedSourceOrgs}
              selectedSourceUsers={selectedSourceUsers}
              onSetService={(id) => setSingleParam("service", id)}
              onToggleTag={(name) => toggleListParam("tags", name)}
              onToggleAuthor={(id) => toggleListParam("authors", id)}
              onToggleGrantOrg={(id) => toggleListParam("orgs", id)}
              onToggleGrantUser={(id) => toggleListParam("users", id)}
              onToggleSourceOrg={(id) => toggleListParam("srcOrgs", id)}
              onToggleSourceUser={(id) => toggleListParam("srcUsers", id)}
            />
          </aside>

          <main className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
            {activeLoading ? (
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 pb-4">
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
                className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 pb-4"
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
          </main>
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
        w-full px-3 py-2 rounded-md font-text text-sm transition-all cursor-pointer
        inline-flex items-center justify-center gap-2 whitespace-nowrap
        ${active
          ? "bg-accent/20 text-accent border border-accent/50"
          : "text-meta hover:text-strong"}
      `}
    >
      <span className="whitespace-nowrap">{label}</span>
      {count !== undefined && (
        <span
          className={`
            shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px]
            ${active ? "bg-accent/30 text-accent" : "bg-elevated text-meta"}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter sidebar
// ---------------------------------------------------------------------------

interface FilterSidebarProps {
  tab: ExploreTab;
  selectedServiceId?: string;
  selectedTags: string[];
  selectedAuthors: string[];
  selectedGrantOrgs: string[];
  selectedGrantUsers: string[];
  selectedSourceOrgs: string[];
  selectedSourceUsers: string[];
  onSetService: (id: string | undefined) => void;
  onToggleTag: (name: string) => void;
  onToggleAuthor: (id: string) => void;
  onToggleGrantOrg: (id: string) => void;
  onToggleGrantUser: (id: string) => void;
  onToggleSourceOrg: (id: string) => void;
  onToggleSourceUser: (id: string) => void;
}

function FilterSidebar(props: FilterSidebarProps) {
  switch (props.tab) {
    case "system":
      return (
        <SystemFilters
          selectedServiceId={props.selectedServiceId}
          onSetService={props.onSetService}
        />
      );
    case "public":
      return (
        <PublicFilters
          selectedTags={props.selectedTags}
          selectedAuthors={props.selectedAuthors}
          onToggleTag={props.onToggleTag}
          onToggleAuthor={props.onToggleAuthor}
        />
      );
    case "my-skills":
      return (
        <MyFilters
          selectedTags={props.selectedTags}
          selectedGrantOrgs={props.selectedGrantOrgs}
          selectedGrantUsers={props.selectedGrantUsers}
          onToggleTag={props.onToggleTag}
          onToggleGrantOrg={props.onToggleGrantOrg}
          onToggleGrantUser={props.onToggleGrantUser}
        />
      );
    case "shared-with-me":
      return (
        <SharedWithMeFilters
          selectedSourceOrgs={props.selectedSourceOrgs}
          selectedSourceUsers={props.selectedSourceUsers}
          onToggleSourceOrg={props.onToggleSourceOrg}
          onToggleSourceUser={props.onToggleSourceUser}
        />
      );
  }
}

// --- per-tab sidebar bodies ---

function SystemFilters({
  selectedServiceId,
  onSetService,
}: {
  selectedServiceId?: string;
  onSetService: (id: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { data: services = [] } = useSystemServiceFacets();
  return (
    <FilterSection title={t("explore.filterService", "NyxID service") as string}>
      {services.length === 0 ? (
        <FilterEmpty>{t("explore.noServices", "No system services yet.")}</FilterEmpty>
      ) : (
        <FilterChipList>
          {services.map((s) => (
            <FilterChip
              key={s.id}
              label={s.label || s.slug}
              count={s.count}
              selected={selectedServiceId === s.id}
              onClick={() => onSetService(selectedServiceId === s.id ? undefined : s.id)}
            />
          ))}
        </FilterChipList>
      )}
    </FilterSection>
  );
}

function PublicFilters({
  selectedTags,
  selectedAuthors,
  onToggleTag,
  onToggleAuthor,
}: {
  selectedTags: string[];
  selectedAuthors: string[];
  onToggleTag: (name: string) => void;
  onToggleAuthor: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: tags = [] } = useSkillTagFacets("public");
  const { data: authors = [] } = useSkillAuthorFacets("public");
  return (
    <div className="space-y-4">
      <FilterSection title={t("explore.filterTags", "Tag") as string}>
        {tags.length === 0 ? (
          <FilterEmpty>{t("explore.noTags", "No tags yet.")}</FilterEmpty>
        ) : (
          <FilterChipList>
            {tags.map((tag) => (
              <FilterChip
                key={tag.name}
                label={tag.name}
                count={tag.count}
                selected={selectedTags.includes(tag.name)}
                onClick={() => onToggleTag(tag.name)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
      <FilterSection title={t("explore.filterAuthors", "Author") as string}>
        {authors.length === 0 ? (
          <FilterEmpty>{t("explore.noAuthors", "No authors yet.")}</FilterEmpty>
        ) : (
          <FilterChipList>
            {authors.map((a) => (
              <FilterChip
                key={a.userId}
                label={a.displayName || a.email || a.userId}
                count={a.count}
                selected={selectedAuthors.includes(a.userId)}
                onClick={() => onToggleAuthor(a.userId)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
    </div>
  );
}

function MyFilters({
  selectedTags,
  selectedGrantOrgs,
  selectedGrantUsers,
  onToggleTag,
  onToggleGrantOrg,
  onToggleGrantUser,
}: {
  selectedTags: string[];
  selectedGrantOrgs: string[];
  selectedGrantUsers: string[];
  onToggleTag: (name: string) => void;
  onToggleGrantOrg: (id: string) => void;
  onToggleGrantUser: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: tags = [] } = useSkillTagFacets("mine");
  const { data: grants } = useMySkillGrantsSummary();
  const orgs = grants?.orgs ?? [];
  const users = grants?.users ?? [];
  return (
    <div className="space-y-4">
      <FilterSection title={t("explore.filterTags", "Tag") as string}>
        {tags.length === 0 ? (
          <FilterEmpty>{t("explore.noTags", "No tags yet.")}</FilterEmpty>
        ) : (
          <FilterChipList>
            {tags.map((tag) => (
              <FilterChip
                key={tag.name}
                label={tag.name}
                count={tag.count}
                selected={selectedTags.includes(tag.name)}
                onClick={() => onToggleTag(tag.name)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
      <FilterSection title={t("explore.filterSharedWithUsers", "Shared with users") as string}>
        {users.length === 0 ? (
          <FilterEmpty>
            {t("explore.notSharedWithUsers", "You haven't shared any skills with specific users.")}
          </FilterEmpty>
        ) : (
          <FilterChipList>
            {users.map((u) => (
              <FilterChip
                key={u.userId}
                label={u.email || u.displayName || u.userId}
                count={u.skillCount}
                selected={selectedGrantUsers.includes(u.userId)}
                onClick={() => onToggleGrantUser(u.userId)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
      <FilterSection title={t("explore.filterSharedWithOrgs", "Shared with orgs") as string}>
        {orgs.length === 0 ? (
          <FilterEmpty>
            {t("explore.notSharedWithOrgs", "You haven't shared any skills with orgs.")}
          </FilterEmpty>
        ) : (
          <FilterChipList>
            {orgs.map((o) => (
              <FilterChip
                key={o.id}
                label={o.displayName}
                count={o.skillCount}
                selected={selectedGrantOrgs.includes(o.id)}
                onClick={() => onToggleGrantOrg(o.id)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
    </div>
  );
}

function SharedWithMeFilters({
  selectedSourceOrgs,
  selectedSourceUsers,
  onToggleSourceOrg,
  onToggleSourceUser,
}: {
  selectedSourceOrgs: string[];
  selectedSourceUsers: string[];
  onToggleSourceOrg: (id: string) => void;
  onToggleSourceUser: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: sources } = useSharedSkillSources();
  const orgs = sources?.orgs ?? [];
  const users = sources?.users ?? [];
  return (
    <div className="space-y-4">
      <FilterSection title={t("explore.filterSharedByUsers", "Shared by users") as string}>
        {users.length === 0 ? (
          <FilterEmpty>{t("explore.notSharedByUsers", "Nobody has shared with you directly.")}</FilterEmpty>
        ) : (
          <FilterChipList>
            {users.map((u) => (
              <FilterChip
                key={u.userId}
                label={u.email || u.displayName || u.userId}
                count={u.skillCount}
                selected={selectedSourceUsers.includes(u.userId)}
                onClick={() => onToggleSourceUser(u.userId)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
      <FilterSection title={t("explore.filterSharedByOrgs", "Shared via orgs") as string}>
        {orgs.length === 0 ? (
          <FilterEmpty>{t("explore.notSharedByOrgs", "No orgs have shared anything with you.")}</FilterEmpty>
        ) : (
          <FilterChipList>
            {orgs.map((o) => (
              <FilterChip
                key={o.id}
                label={o.displayName}
                count={o.skillCount}
                selected={selectedSourceOrgs.includes(o.id)}
                onClick={() => onToggleSourceOrg(o.id)}
              />
            ))}
          </FilterChipList>
        )}
      </FilterSection>
    </div>
  );
}

// --- sidebar primitives ---

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FilterEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-text text-xs text-meta italic">{children}</p>
  );
}

function FilterChipList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

interface FilterChipProps {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}

function FilterChip({ label, count, selected, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-2 px-2.5 py-1 rounded-full border font-text text-xs transition-all cursor-pointer
        ${selected
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-accent/15 bg-elevated text-strong hover:border-accent/40"}
      `}
    >
      <span className="max-w-[180px] truncate">{label}</span>
      {count !== undefined && (
        <span
          className={`
            px-1.5 rounded font-mono text-[10px]
            ${selected ? "bg-accent/30" : "bg-bg-base/70 text-meta"}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function emptyTitle(tab: ExploreTab, t: (key: string, fallback?: string) => string): string {
  if (tab === "system") return t("explore.noSystemSkills", "No system skills yet");
  if (tab === "public") return t("explore.noSkillsFound", "No public skills match");
  if (tab === "my-skills") return t("explore.noSkillsYet", "You haven't created any skills yet");
  return t("explore.noSharedSkills", "Nothing has been shared with you yet");
}

function emptyDescription(tab: ExploreTab, t: (key: string, fallback?: string) => string): string {
  if (tab === "system")
    return t(
      "explore.systemSkillsHint",
      "System skills are skills tied to a NyxID admin service. Platform admins tie any skill to any admin service to publish it as a system skill.",
    );
  if (tab === "public") return t("explore.tryAdjusting", "Try adjusting your search or filters.");
  if (tab === "my-skills") return t("explore.createFirst", "Create your first skill to get started.");
  return t(
    "explore.sharedHint",
    "When someone grants you access to a private skill — either directly or via an org — it shows up here.",
  );
}
