/**
 * SkillsetExplorePage — the skillset registry (ONE browse page, #1059).
 *
 * Three tabs via `?scope`: Public · Mine · Shared with me. Filters are a
 * simple kind dropdown + tag chips (typed inline) — NO facet sidebars (the
 * backend search surface is intentionally minimal: kind / tags / scope only).
 * Everything is URL-encoded so a filtered view is copy-pasteable.
 *
 *   Public         → anyone (anon + authed)
 *   Mine           → authed only
 *   Shared with me → authed only
 *
 * When `pinScope` is set (the /my-skillsets wrapper passes "mine"), the tab
 * strip is hidden and the page renders that single scope.
 *
 * @module pages/SkillsetExplorePage
 */

import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { SkillsetCard } from "@/components/skillset/SkillsetCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import {
  usePublicSkillsets,
  useMySkillsets,
  useSharedWithMeSkillsets,
} from "@/hooks/useSkillsets";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import { SKILLSET_KINDS, type SkillsetKind } from "@/types/skillset";

type ExploreTab = "public" | "mine" | "shared-with-me";

const DEFAULT_PAGE_SIZE = 20;

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

function parseTab(raw: string | null, authed: boolean): ExploreTab {
  if (raw === "mine" || raw === "shared-with-me") return authed ? raw : "public";
  return "public";
}

function parseKind(raw: string | null): SkillsetKind | undefined {
  return SKILLSET_KINDS.includes(raw as SkillsetKind) ? (raw as SkillsetKind) : undefined;
}

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

export interface SkillsetExplorePageProps {
  /** Pin the page to a single scope and hide the tab strip (My Skillsets). */
  pinScope?: ExploreTab | undefined;
}

export function SkillsetExplorePage({ pinScope }: SkillsetExplorePageProps = {}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  const activeTab = pinScope ?? parseTab(searchParams.get("scope"), isAuthenticated);
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const activePage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const selectedKind = parseKind(searchParams.get("kind"));
  const selectedTags = useMemo(
    () => parseCsvParam(searchParams.get("tags")),
    [searchParams],
  );

  const listParams = {
    kind: selectedKind,
    tags: selectedTags,
    page: activePage,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  const { data: publicData, isLoading: publicLoading } = usePublicSkillsets({
    ...listParams,
    enabled: activeTab === "public",
  });
  const { data: mineData, isLoading: mineLoading } = useMySkillsets({
    ...listParams,
    enabled: activeTab === "mine" && isAuthenticated,
  });
  const { data: sharedData, isLoading: sharedLoading } = useSharedWithMeSkillsets({
    ...listParams,
    enabled: activeTab === "shared-with-me" && isAuthenticated,
  });

  const activeData =
    activeTab === "public" ? publicData : activeTab === "mine" ? mineData : sharedData;
  const activeLoading =
    activeTab === "public" ? publicLoading : activeTab === "mine" ? mineLoading : sharedLoading;

  const totalPages = activeData?.totalPages ?? 0;
  const items = useMemo(() => activeData?.items ?? [], [activeData]);

  function handleTabChange(tab: ExploreTab) {
    const next = new URLSearchParams();
    if (tab !== "public") next.set("scope", tab);
    setSearchParams(next);
  }

  function handlePageChange(p: number) {
    const next = new URLSearchParams(searchParams);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    setSearchParams(next);
  }

  function setKind(kind: SkillsetKind | undefined) {
    const next = new URLSearchParams(searchParams);
    if (!kind) next.delete("kind");
    else next.set("kind", kind);
    next.delete("page");
    setSearchParams(next);
  }

  function toggleTag(tag: string) {
    const next = new URLSearchParams(searchParams);
    const current = parseCsvParam(next.get("tags"));
    const updated = current.includes(tag)
      ? current.filter((v) => v !== tag)
      : [...current, tag];
    if (updated.length === 0) next.delete("tags");
    else next.set("tags", updated.join(","));
    next.delete("page");
    setSearchParams(next);
  }

  function addTagFromInput(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || selectedTags.includes(tag)) return;
    toggleTag(tag);
  }

  function emptyTitle(tab: ExploreTab): string {
    if (tab === "mine")
      return t("skillsetExplore.noneMine", "You haven't created any skillsets yet");
    if (tab === "shared-with-me")
      return t("skillsetExplore.noneShared", "Nothing has been shared with you yet");
    return t("skillsetExplore.nonePublic", "No public skillsets match");
  }

  function emptyDescription(tab: ExploreTab): string {
    if (tab === "mine")
      return t("skillsetExplore.createFirst", "Bundle two or more skills into your first skillset.");
    if (tab === "shared-with-me")
      return t(
        "skillsetExplore.sharedIntro",
        "When someone grants you access to a private skillset, it shows up here.",
      );
    return t("skillsetExplore.tryAdjusting", "Try adjusting the kind or tag filters.");
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2 gap-3">
        {/* Tabs (hidden when pinned). */}
        {!pinScope && (
          <div className="shrink-0 flex justify-center">
            <div
              className={`grid rounded border border-accent/20 bg-elevated p-1 gap-1 w-full max-w-xl ${
                isAuthenticated ? "grid-cols-3" : "grid-cols-1"
              }`}
            >
              <TabButton
                label={t("skillsetExplore.publicTab", "Public")}
                active={activeTab === "public"}
                onClick={() => handleTabChange("public")}
              />
              {isAuthenticated && (
                <>
                  <TabButton
                    label={t("skillsetExplore.mineTab", "Mine")}
                    active={activeTab === "mine"}
                    onClick={() => handleTabChange("mine")}
                  />
                  <TabButton
                    label={t("skillsetExplore.sharedTab", "Shared with me")}
                    active={activeTab === "shared-with-me"}
                    onClick={() => handleTabChange("shared-with-me")}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Filters: kind dropdown + tag chips. */}
        <div className="shrink-0 flex flex-wrap items-center gap-3">
          <KindFilter selected={selectedKind} onChange={setKind} />
          <TagFilter
            tags={selectedTags}
            onAdd={addTagFromInput}
            onRemove={toggleTag}
          />
          {activeTab === "mine" && isAuthenticated && (
            <Button size="sm" className="ml-auto" onClick={() => navigate("/skillsets/new")}>
              {t("skillsetExplore.create", "New skillset")}
            </Button>
          )}
        </div>

        {/* Cards. */}
        <main className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
          {activeLoading ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 pb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                // Positional list — never reorders, key={i} is intentional (#451).
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={emptyTitle(activeTab)}
              description={emptyDescription(activeTab)}
              action={
                activeTab === "mine" && isAuthenticated ? (
                  <Button onClick={() => navigate("/skillsets/new")}>
                    {t("skillsetExplore.create", "New skillset")}
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
              {items.map((skillset) => (
                <motion.div key={skillset.guid} variants={itemVariants}>
                  <SkillsetCard
                    skillset={skillset}
                    showOwnerControls={activeTab === "mine"}
                    currentUserId={user?.id}
                    onEdit={
                      activeTab === "mine"
                        ? (s) => navigate(`/skillsets/${s.guid}/edit`)
                        : undefined
                    }
                  />
                </motion.div>
              ))}
            </motion.div>
          )}

          <Pagination page={activePage} totalPages={totalPages} onPageChange={handlePageChange} />
        </main>
      </div>
    </PageTransition>
  );
}

interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-2 rounded-md font-text text-sm transition-all cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap ${
        active
          ? "bg-accent/20 text-accent border border-accent/50"
          : "text-meta hover:text-strong"
      }`}
    >
      {label}
    </button>
  );
}

function KindFilter({
  selected,
  onChange,
}: {
  selected: SkillsetKind | undefined;
  onChange: (kind: SkillsetKind | undefined) => void;
}) {
  const { t } = useTranslation();
  const options: { value: SkillsetKind | "all"; label: string }[] = [
    { value: "all", label: t("skillsetExplore.kindAll", "All kinds") },
    { value: "generic", label: t("skillsetKind.generic", "Bundle") },
    {
      value: "consensus-supported",
      label: t("skillsetKind.consensusSupported", "Consensus"),
    },
  ];
  return (
    <label className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {t("skillsetExplore.kindLabel", "Kind")}
      </span>
      <select
        value={selected ?? "all"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "all" ? undefined : (v as SkillsetKind));
        }}
        className="rounded-sm border border-subtle bg-elevated/40 px-2 py-1.5 font-text text-sm text-strong focus:border-accent focus:outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TagFilter({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {t("skillsetExplore.tagsLabel", "Tags")}
      </span>
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onRemove(tag)}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-2.5 py-1 font-text text-xs text-accent cursor-pointer"
        >
          <span className="max-w-[140px] truncate">{tag}</span>
          <span aria-hidden>×</span>
        </button>
      ))}
      <input
        type="text"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        placeholder={t("skillsetExplore.addTag", "add tag…") as string}
        className="w-28 rounded-sm border border-subtle bg-elevated/40 px-2 py-1.5 font-text text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none"
        aria-label={t("skillsetExplore.addTag", "add tag…") as string}
      />
    </div>
  );
}
