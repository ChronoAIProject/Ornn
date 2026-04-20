import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Topic } from "@/types/domain";

export interface TopicCardProps {
  topic: Topic;
  className?: string;
}

/**
 * Grid tile for a single topic. Mirrors the visual density of SkillCard
 * so topic and skill grids can sit side-by-side consistently.
 */
export function TopicCard({ topic, className = "" }: TopicCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Card
      hoverable
      className={`flex flex-col gap-3 ${className}`}
      onClick={() => navigate(`/topics/${encodeURIComponent(topic.name)}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-heading text-base text-neon-cyan truncate">{topic.name}</h3>
        {topic.isPrivate && (
          <Badge color="cyan" className="shrink-0 text-[10px]">
            {t("common.private")}
          </Badge>
        )}
      </div>
      {topic.description && (
        <p className="font-body text-sm text-text-muted line-clamp-3">{topic.description}</p>
      )}
      <div className="mt-auto flex items-center justify-between pt-2 border-t border-neon-cyan/10">
        <span className="font-body text-xs text-text-muted">
          {t("topic.skillCount", { count: topic.skillCount })}
        </span>
        {topic.createdByDisplayName && (
          <span className="font-body text-xs text-text-muted truncate max-w-[60%]">
            {topic.createdByDisplayName}
          </span>
        )}
      </div>
    </Card>
  );
}
