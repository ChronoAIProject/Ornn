import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/layout/PageTransition";
import { SearchBar } from "@/components/search/SearchBar";
import { SkillGrid } from "@/components/skill/SkillGrid";
import { SkillCard } from "@/components/skill/SkillCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSearchStore } from "@/stores/searchStore";
import { useSkills, useMySkills } from "@/hooks/useSkills";
import { useCurrentUser, useIsAuthenticated } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  getSystemSkills,
  generateSystemSkill,
  regenerateSystemSkill,
  deleteSystemSkill,
  type SystemSkillItem,
} from "@/services/systemSkillsApi";

type ExploreTab = "public" | "my-skills" | "system";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

const DEFAULT_PAGE_SIZE = 20;

function SystemSkillsTab({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [generatingServiceId, setGeneratingServiceId] = useState<string | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["system-skills"],
    queryFn: getSystemSkills,
  });

  const generateMutation = useMutation({
    mutationFn: (serviceId: string) => generateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingServiceId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" generated` });
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setGeneratingServiceId(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
      setGeneratingServiceId(null);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (serviceId: string) => regenerateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingServiceId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" regenerated` });
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      setGeneratingServiceId(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
      setGeneratingServiceId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (serviceId: string) => deleteSystemSkill(serviceId),
    onSuccess: () => {
      addToast({ type: "success", message: "System skill deleted" });
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}><Skeleton lines={4} /></Card>
        ))}
      </div>
    );
  }

  if (!items?.length) {
    return (
      <EmptyState
        title="No system services"
        description="No services found in NyxID registry."
      />
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4"
    >
      {items.map((item) => {
        const isGenerating = generatingServiceId === item.serviceId;

        return (
          <motion.div key={item.serviceId} variants={itemVariants}>
            <Card className="flex flex-col h-full">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-mono text-sm font-semibold text-neon-cyan truncate">
                    {item.serviceName}
                  </h3>
                  <p className="font-body text-xs text-text-muted mt-0.5 truncate">
                    {item.baseUrl}
                  </p>
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  <Badge color={item.hasOpenApiSpec ? "green" : "cyan"}>
                    {item.hasOpenApiSpec ? "spec" : "no spec"}
                  </Badge>
                  <Badge color="yellow">{item.serviceCategory}</Badge>
                </div>
              </div>

              {item.serviceDescription && (
                <p className="font-body text-xs text-text-muted mb-3 line-clamp-2">
                  {item.serviceDescription}
                </p>
              )}

              <div className="mt-auto pt-3 border-t border-neon-cyan/10">
                {item.skillGenerated && item.skill ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge color="green">generated</Badge>
                      <span className="font-mono text-xs text-text-muted truncate">
                        {item.skill.name}
                      </span>
                    </div>
                    {item.skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.skill.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="font-mono text-[10px] text-text-muted bg-bg-deep px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/skills/${item.skill!.name}`)}
                      >
                        Preview
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => regenerateMutation.mutate(item.serviceId)}
                            disabled={isGenerating}
                          >
                            {isGenerating ? "..." : "Regenerate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => deleteMutation.mutate(item.serviceId)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-body text-xs text-text-muted italic">
                      No skill generated yet
                    </p>
                    {isAdmin && item.hasOpenApiSpec ? (
                      <Button
                        size="sm"
                        onClick={() => generateMutation.mutate(item.serviceId)}
                        disabled={isGenerating}
                      >
                        {isGenerating ? "Generating..." : "Generate Skill"}
                      </Button>
                    ) : !item.hasOpenApiSpec ? (
                      <p className="font-body text-[10px] text-text-muted">
                        No OpenAPI spec. Add spec URL in NyxID to enable.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

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

  const isPublicTab = activeTab === "public";
  const isSystemTab = activeTab === "system";
  const isMySkillsTab = activeTab === "my-skills";
  const data = isPublicTab ? publicData : isMySkillsTab ? mySkillsData : null;
  const isLoading = isPublicTab ? publicLoading : isMySkillsTab ? mySkillsLoading : false;
  const currentPage = isPublicTab ? page : mySkillsPage;
  const totalPages = data?.totalPages ?? 0;

  // Rough admin check: user has admin-related permissions
  const isAdmin = user?.roles?.some((r: string) => r.includes("admin")) ?? false;

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

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      {/* Tab selector */}
      {isAuthenticated && (
        <div className="mb-3 flex justify-center shrink-0">
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
          </div>
        </div>
      )}

      {!isSystemTab && <SearchBar className="mb-3 shrink-0" />}

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
        {isSystemTab ? (
          <SystemSkillsTab isAdmin={isAdmin} />
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
