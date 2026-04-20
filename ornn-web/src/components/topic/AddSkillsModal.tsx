import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSkills, useMySkills } from "@/hooks/useSkills";
import { useAddSkillsToTopic } from "@/hooks/useTopics";
import { useToastStore } from "@/stores/toastStore";
import type { SkillSearchResult } from "@/types/search";

export interface AddSkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
  topicIdOrName: string;
  /** Skill GUIDs already in the topic — suppressed from results. */
  existingSkillGuids: string[];
}

/**
 * Skill-picker modal. Searches in two scopes (public + mine) and merges
 * results so the user can pull in their own private skills too.
 */
export function AddSkillsModal({
  isOpen,
  onClose,
  topicIdOrName,
  existingSkillGuids,
}: AddSkillsModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const mutation = useAddSkillsToTopic(topicIdOrName);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, SkillSearchResult>>(new Map());

  const { data: publicData, isLoading: publicLoading } = useSkills({
    query: query || undefined,
    page: 1,
    pageSize: 20,
  });
  const { data: myData, isLoading: myLoading } = useMySkills({
    query: query || undefined,
    page: 1,
    pageSize: 20,
  });

  const existingSet = useMemo(() => new Set(existingSkillGuids), [existingSkillGuids]);

  const merged: SkillSearchResult[] = useMemo(() => {
    const seen = new Set<string>();
    const out: SkillSearchResult[] = [];
    for (const s of [...(myData?.items ?? []), ...(publicData?.items ?? [])]) {
      if (seen.has(s.guid)) continue;
      if (existingSet.has(s.guid)) continue;
      seen.add(s.guid);
      out.push(s);
    }
    return out;
  }, [publicData, myData, existingSet]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelected(new Map());
    }
  }, [isOpen]);

  const toggle = (skill: SkillSearchResult) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(skill.guid)) next.delete(skill.guid);
      else next.set(skill.guid, skill);
      return next;
    });
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    onClose();
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    try {
      const result = await mutation.mutateAsync({ skillIds: [...selected.keys()] });
      addToast({
        type: "success",
        message: t("topic.addSkillsSuccess", {
          added: result.added.length,
          skipped: result.skipped.length,
        }),
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("topic.addSkillsFailed");
      addToast({ type: "error", message });
    }
  };

  const loading = publicLoading || myLoading;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("topic.addSkills")}>
      <div className="space-y-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("topic.searchSkillsPlaceholder")}
        />

        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[...selected.values()].map((s) => (
              <Badge key={s.guid} color="cyan">
                <span onClick={() => toggle(s)} className="cursor-pointer">
                  {s.name} ×
                </span>
              </Badge>
            ))}
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto border-t border-neon-cyan/10 pt-2">
          {loading ? (
            <Skeleton lines={6} />
          ) : merged.length === 0 ? (
            <p className="py-8 text-center font-body text-sm text-text-muted">
              {t("topic.noMatchingSkills")}
            </p>
          ) : (
            <ul className="space-y-1">
              {merged.map((s) => {
                const isSelected = selected.has(s.guid);
                return (
                  <li key={s.guid}>
                    <button
                      type="button"
                      onClick={() => toggle(s)}
                      className={`
                        flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left
                        cursor-pointer transition-colors
                        ${
                          isSelected
                            ? "border-neon-cyan/60 bg-neon-cyan/10"
                            : "border-transparent bg-bg-elevated/40 hover:border-neon-cyan/30"
                        }
                      `}
                    >
                      <span className="mt-0.5 w-4 text-neon-cyan shrink-0">
                        {isSelected ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm text-text-primary truncate">{s.name}</span>
                          {s.isPrivate && (
                            <Badge color="muted" className="text-[10px]">
                              {t("common.private")}
                            </Badge>
                          )}
                        </div>
                        {s.description && (
                          <p className="font-body text-xs text-text-muted line-clamp-1 mt-0.5">
                            {s.description}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={handleClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={handleAdd}
          loading={mutation.isPending}
          disabled={selected.size === 0}
        >
          {t("topic.addNSelected", { count: selected.size })}
        </Button>
      </div>
    </Modal>
  );
}
