import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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

type ExploreTab = "public" | "my-skills";

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
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();
  const [activeTab, setActiveTab] = useState<ExploreTab>("public");
  const [mySkillsPage, setMySkillsPage] = useState(1);

  const { query, page, setPage } = useSearchStore();

  // Fetch public skills
  const { data: publicData, isLoading: publicLoading } = useSkills({
    query: query || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // Fetch my skills (only when authenticated and on my-skills tab)
  const { data: mySkillsData, isLoading: mySkillsLoading } = useMySkills({
    query: query || undefined,
    page: mySkillsPage,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const isPublicTab = activeTab === "public";
  const data = isPublicTab ? publicData : mySkillsData;
  const isLoading = isPublicTab ? publicLoading : mySkillsLoading;
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
    setActiveTab(tab);
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="neon-cyan mb-2 font-heading text-3xl font-bold tracking-wider text-neon-cyan sm:text-4xl">
            EXPLORE SKILLS
          </h1>
          <p className="font-body text-text-muted">
            Discover, download, and share reusable skills for agentic AI systems
          </p>
        </div>
        {isAuthenticated && (
          <Button onClick={() => navigate("/skills/new")}>
            Create Skill
          </Button>
        )}
      </div>

      {/* Tab selector (only show when authenticated) */}
      {isAuthenticated && (
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg border border-neon-cyan/20 bg-bg-elevated p-1">
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
              Public Skills
            </button>
            <button
              onClick={() => handleTabChange("my-skills")}
              className={`
                px-4 py-2 rounded-md font-body text-sm transition-all
                ${!isPublicTab
                  ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                  : "text-text-muted hover:text-text-primary"
                }
              `}
            >
              My Skills
            </button>
          </div>
        </div>
      )}

      <SearchBar className="mb-6" />

      {/* Skills grid */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title={isPublicTab ? "No skills found" : "No skills yet"}
          description={
            isPublicTab
              ? "Try adjusting your search, or upload the first skill."
              : "Create your first skill to get started"
          }
          action={
            <Button onClick={() => navigate("/skills/new")}>
              {isPublicTab ? "Upload Skill" : "Create Skill"}
            </Button>
          }
        />
      ) : isPublicTab ? (
        <SkillGrid skills={data?.items ?? []} isLoading={isLoading} className="mb-8" />
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-8"
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

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
    </PageTransition>
  );
}
