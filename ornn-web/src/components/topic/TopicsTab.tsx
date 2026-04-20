import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SearchBar } from "@/components/search/SearchBar";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { TopicCard } from "./TopicCard";
import { CreateTopicModal } from "./CreateTopicModal";
import { useTopicsList } from "@/hooks/useTopics";
import { useIsAuthenticated } from "@/stores/authStore";
import { useSearchStore } from "@/stores/searchStore";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" as const } },
};

const DEFAULT_PAGE_SIZE = 20;

/**
 * Topics tab rendered inside ExplorePage. Reuses the shared SearchBar
 * (bound to the same `useSearchStore`) so a search query entered on the
 * skills tabs also narrows topics when the user switches — matching how
 * System Skills works today. Pagination is local.
 */
export function TopicsTab() {
  const { t } = useTranslation();
  const isAuthenticated = useIsAuthenticated();
  const query = useSearchStore((s) => s.query);

  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useTopicsList({
    query: query || undefined,
    scope: isAuthenticated ? "mixed" : "public",
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="mb-3 flex gap-3 items-start shrink-0">
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
        {isAuthenticated && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            {t("topic.createTopic")}
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass rounded-xl p-6">
                <Skeleton lines={3} />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={query ? t("topic.noTopicsMatch") : t("topic.noTopicsYet")}
            description={query ? t("topic.tryAdjusting") : t("topic.createFirst")}
            action={
              isAuthenticated && !query ? (
                <Button onClick={() => setShowCreate(true)}>{t("topic.createTopic")}</Button>
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
            {items.map((topic) => (
              <motion.div key={topic.guid} variants={itemVariants}>
                <TopicCard topic={topic} />
              </motion.div>
            ))}
          </motion.div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <CreateTopicModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
