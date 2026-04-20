import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/layout/PageTransition";
import { SearchBar } from "@/components/search/SearchBar";
import { SkillGrid } from "@/components/skill/SkillGrid";
import { SkillCard } from "@/components/skill/SkillCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useSearchStore } from "@/stores/searchStore";
import { useSkills, useMySkills } from "@/hooks/useSkills";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import { getPublicSystemSkills } from "@/services/systemSkillsApi";
import type { SkillSearchResult } from "@/types/search";

type ExploreTab = "system" | "public" | "my-skills";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

const DEFAULT_PAGE_SIZE = 20;

export function ExplorePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();

  const tabParam = searchParams.get("tab");
  const activeTab: ExploreTab = tabParam === "my-skills" ? "my-skills" : tabParam === "system" ? "system" : "public";
  const [mySkillsPage, setMySkillsPage] = useState(1);

  const { query, mode, page, setPage } = useSearchStore();

  const { data: publicData, isLoading: publicLoading } = useSkills({
    query: query || undefined,
    mode,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const { data: mySkillsData, isLoading: mySkillsLoading } = useMySkills({
    query: query || undefined,
    mode,
    page: mySkillsPage,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // Fetch generated system skills (plain skill cards, same shape as regular skills)
  const { data: systemSkillsData, isLoading: systemLoading } = useQuery({
    queryKey: ["system-skills-public"],
    queryFn: async () => {
      const res = await getPublicSystemSkills();
      return res?.items ?? [];
    },
    enabled: activeTab === "system",
  });

  const isPublicTab = activeTab === "public";
  const isSystemTab = activeTab === "system";
  const isMySkillsTab = activeTab === "my-skills";

  const data = isPublicTab ? publicData : isMySkillsTab ? mySkillsData : null;
  const isLoading = isPublicTab ? publicLoading : isMySkillsTab ? mySkillsLoading : systemLoading;
  const currentPage = isPublicTab ? page : mySkillsPage;
  const totalPages = data?.totalPages ?? 0;

  const handlePageChange = (newPage: number) => {
    if (isPublicTab) {
      setPage(newPage);
    } else {
      setMySkillsPage(newPage);
    }
  };

  const handleTabChange = (tab: ExploreTab) => {
    if (tab === "public") {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  // Map system skills to SkillSearchResult shape for SkillCard
  const systemSkills: SkillSearchResult[] = (systemSkillsData ?? []).map((s) => ({
    guid: s.guid,
    name: s.name,
    description: s.description,
    createdBy: "",
    createdOn: s.createdOn,
    updatedOn: s.updatedOn,
    isPrivate: false,
    tags: s.tags ?? [],
  }));

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      {/* Tab selector */}
      {isAuthenticated && (
        <div className="mb-3 flex justify-center shrink-0">
          <div className="inline-flex rounded-lg border border-neon-cyan/20 bg-bg-elevated p-1">
            <button
              onClick={() => handleTabChange("system")}
              className={`
                px-4 py-2 rounded-md font-body text-sm transition-all
                ${isSystemTab
                  ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                  : "text-text-muted hover:text-text-primary"
                }
              `}
            >
              System Skills
            </button>
            <button
              onClick={() => handleTabChange("public")}
              className={`
                px-4 py-2 rounded-md font-body text-sm transition-all
                ${isPublicTab
                  ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                  : "text-text-muted hover:text-text-primary"
                }
              `}
            >
              {t("explore.publicSkills")}
            </button>
            <button
              onClick={() => handleTabChange("my-skills")}
              className={`
                px-4 py-2 rounded-md font-body text-sm transition-all
                ${isMySkillsTab
                  ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                  : "text-text-muted hover:text-text-primary"
                }
              `}
            >
              {t("explore.mySkills")}
            </button>
          </div>
        </div>
      )}

      {!isSystemTab && <SearchBar className="mb-3 shrink-0" />}

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
        {isSystemTab ? (
          systemLoading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : systemSkills.length === 0 ? (
            <EmptyState
              title="No system skills yet"
              description="System skills will appear here once generated by an admin."
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4"
            >
              {systemSkills.map((skill) => (
                <motion.div key={skill.guid} variants={itemVariants}>
                  <SkillCard skill={skill} />
                </motion.div>
              ))}
            </motion.div>
          )
        ) : isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : data?.items.length === 0 ? (
          <EmptyState
            title={isPublicTab ? t("explore.noSkillsFound") : t("explore.noSkillsYet")}
            description={
              isPublicTab
                ? t("explore.tryAdjusting")
                : t("explore.createFirst")
            }
            action={isAuthenticated ? (
              <Button onClick={() => navigate("/skills/new")}>
                {isPublicTab ? t("explore.uploadSkill") : t("explore.createSkill")}
              </Button>
            ) : undefined}
          />
        ) : isPublicTab ? (
          <SkillGrid skills={data?.items ?? []} isLoading={isLoading} className="pb-4" />
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4"
          >
            {data?.items.map((skill) => (
              <motion.div key={skill.guid} variants={itemVariants}>
                <SkillCard
                  skill={skill}
                  showOwnerControls
                  currentUserId={user?.id}
                />
              </motion.div>
            ))}
          </motion.div>
        )}

        {!isSystemTab && <Pagination page={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />}
      </div>
      </div>
    </PageTransition>
  );
}
