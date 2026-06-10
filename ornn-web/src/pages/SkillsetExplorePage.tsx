/**
 * SkillsetExplorePage — the skillset registry (ONE browse page, #1059, #1067).
 *
 * Mirrors the skill registry shell (#1067): the shared `RegistryTabs` strip,
 * a left filter `aside` built from `RegistrySidebar` primitives, and the shared
 * `RegistryGrid` for the cards + pagination.
 *
 * Three tabs via `?scope`: Public · Mine · Shared with me. Filters are Kind +
 * Tags only — the skillset-search backend has NO `q` keyword param, so this
 * page deliberately mounts NO `SearchBar` (mounting one would fake a capability
 * the API doesn't have). Kind is a chip section; Tags are typed inline and
 * shown as removable chips. Everything is URL-encoded so a filtered view is
 * copy-pasteable.
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
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import {
  FilterSection,
  FilterChipList,
  FilterChip,
} from "@/components/registry/RegistrySidebar";
import { RegistryTabs, type RegistryTab } from "@/components/registry/RegistryTabs";
import { RegistryGrid } from "@/components/registry/RegistryGrid";
import { SkillsetCard } from "@/components/skillset/SkillsetCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  usePublicSkillsets,
  useMySkillsets,
  useSharedWithMeSkillsets,
} from "@/hooks/useSkillsets";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import { SKILLSET_KINDS, type SkillsetKind } from "@/types/skillset";

type ExploreTab = "public" | "mine" | "shared-with-me";

const DEFAULT_PAGE_SIZE = 20;

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

  // Tab descriptors for the shared RegistryTabs strip. Mine + Shared require
  // auth. No counts — the skillset search surface doesn't return per-scope
  // totals the way the skill counts endpoint does.
  const tabs: RegistryTab[] = [
    { id: "public", label: t("skillsetExplore.publicTab", "Public") },
    ...(isAuthenticated
      ? [
          { id: "mine", label: t("skillsetExplore.mineTab", "Mine") },
          {
            id: "shared-with-me",
            label: t("skillsetExplore.sharedTab", "Shared with me"),
          },
        ]
      : []),
  ];

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
          <RegistryTabs
            tabs={tabs}
            activeId={activeTab}
            onSelect={(id) => handleTabChange(id as ExploreTab)}
            maxWidthClassName="max-w-xl"
          />
        )}

        {/* 2-col: filter sidebar (Kind + Tags) + cards. NO SearchBar — the
            skillset-search backend has no `q` keyword param. */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-4">
          <aside className="lg:w-[280px] shrink-0 lg:overflow-y-auto lg:pr-1">
            <div className="space-y-4">
              <KindSection selected={selectedKind} onSelect={setKind} />
              <TagsSection
                tags={selectedTags}
                onAdd={addTagFromInput}
                onRemove={toggleTag}
              />
              {activeTab === "mine" && isAuthenticated && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => navigate("/skillsets/new")}
                >
                  {t("skillsetExplore.create", "New skillset")}
                </Button>
              )}
            </div>
          </aside>

          <main className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
            <RegistryGrid
              items={items}
              loading={activeLoading}
              getKey={(skillset) => skillset.guid}
              renderItem={(skillset) => (
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
              )}
              empty={
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
              }
              page={activePage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </main>
        </div>
      </div>
    </PageTransition>
  );
}

/**
 * Kind facet — a small chip section (All / Bundle / Consensus) rendered with
 * the shared RegistrySidebar primitives, replacing the old inline `<select>`.
 */
function KindSection({
  selected,
  onSelect,
}: {
  selected: SkillsetKind | undefined;
  onSelect: (kind: SkillsetKind | undefined) => void;
}) {
  const { t } = useTranslation();
  const options: { value: SkillsetKind | undefined; label: string }[] = [
    { value: undefined, label: t("skillsetExplore.kindAll", "All kinds") },
    { value: "generic", label: t("skillsetKind.generic", "Bundle") },
    {
      value: "consensus-supported",
      label: t("skillsetKind.consensusSupported", "Consensus"),
    },
  ];
  return (
    <FilterSection title={t("skillsetExplore.kindLabel", "Kind") as string}>
      <FilterChipList>
        {options.map((o) => (
          <FilterChip
            key={o.value ?? "all"}
            label={o.label}
            selected={selected === o.value}
            onClick={() => onSelect(selected === o.value ? undefined : o.value)}
          />
        ))}
      </FilterChipList>
    </FilterSection>
  );
}

/**
 * Tags facet — selected tags as removable chips plus a free-text input that
 * adds a tag on Enter. The backend has no tag-facet endpoint for skillsets, so
 * tags are author-typed rather than enumerated.
 */
function TagsSection({
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
    <FilterSection title={t("skillsetExplore.tagsLabel", "Tags") as string}>
      <div className="flex flex-wrap items-center gap-2">
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
    </FilterSection>
  );
}
