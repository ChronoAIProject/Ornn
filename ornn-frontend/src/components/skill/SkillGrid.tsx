import { motion } from "framer-motion";
import { SkillCard } from "./SkillCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import type { SkillSearchResult } from "@/types/search";
import { useNavigate } from "react-router-dom";

export interface SkillGridProps {
  skills: SkillSearchResult[];
  isLoading: boolean;
  className?: string;
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

export function SkillGrid({ skills, isLoading, className = "" }: SkillGridProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        title="No skills found"
        description="Try adjusting your search or filters, or upload the first skill."
        action={<Button onClick={() => navigate("/skills/new")}>Upload Skill</Button>}
      />
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {skills.map((skill) => (
        <motion.div key={skill.guid} variants={itemVariants}>
          <SkillCard skill={skill} />
        </motion.div>
      ))}
    </motion.div>
  );
}
