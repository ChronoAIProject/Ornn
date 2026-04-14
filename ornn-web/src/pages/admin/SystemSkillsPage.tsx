/**
 * Admin System Skills Page.
 * Lists NyxID services and their auto-generated skills.
 * Admin can generate, regenerate, preview, and delete system skills.
 * @module pages/admin/SystemSkillsPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  getSystemSkills,
  generateSystemSkill,
  regenerateSystemSkill,
  deleteSystemSkill,
  type SystemSkillItem,
} from "@/services/systemSkillsApi";
import { useToastStore } from "@/stores/toastStore";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SystemSkillsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [deleteTarget, setDeleteTarget] = useState<SystemSkillItem | null>(null);
  const [generatingServiceId, setGeneratingServiceId] = useState<string | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["admin", "system-skills"],
    queryFn: getSystemSkills,
  });

  const generateMutation = useMutation({
    mutationFn: (serviceId: string) => generateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingServiceId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" generated successfully` });
      queryClient.invalidateQueries({ queryKey: ["admin", "system-skills"] });
      setGeneratingServiceId(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: `Generation failed: ${err.message}` });
      setGeneratingServiceId(null);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (serviceId: string) => regenerateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingServiceId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" regenerated successfully` });
      queryClient.invalidateQueries({ queryKey: ["admin", "system-skills"] });
      setGeneratingServiceId(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: `Regeneration failed: ${err.message}` });
      setGeneratingServiceId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (serviceId: string) => deleteSystemSkill(serviceId),
    onSuccess: () => {
      addToast({ type: "success", message: "System skill deleted" });
      queryClient.invalidateQueries({ queryKey: ["admin", "system-skills"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: `Delete failed: ${err.message}` });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-xl tracking-wider text-text-primary">System Skills</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><Skeleton lines={4} /></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl tracking-wider text-text-primary">System Skills</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            Auto-generated skills from NyxID service catalog. {items?.length ?? 0} services found.
          </p>
        </div>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items?.map((item) => {
          const isGenerating = generatingServiceId === item.serviceId;

          return (
            <motion.div key={item.serviceId} variants={itemVariants}>
              <Card className="flex flex-col h-full">
                {/* Service info */}
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
                    <Badge color="orange">{item.serviceCategory}</Badge>
                  </div>
                </div>

                {item.serviceDescription && (
                  <p className="font-body text-xs text-text-muted mb-3 line-clamp-2">
                    {item.serviceDescription}
                  </p>
                )}

                {/* Skill status */}
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
                      <p className="font-body text-[10px] text-text-muted">
                        Generated: {formatDate(item.skill.createdOn)}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => navigate(`/skills/${item.skill!.name}`)}
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => regenerateMutation.mutate(item.serviceId)}
                          disabled={isGenerating}
                        >
                          {isGenerating ? "Regenerating..." : "Regenerate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-body text-xs text-text-muted italic">
                        No skill generated yet
                      </p>
                      {item.hasOpenApiSpec ? (
                        <Button
                          size="sm"
                          onClick={() => generateMutation.mutate(item.serviceId)}
                          disabled={isGenerating}
                        >
                          {isGenerating ? "Generating..." : "Generate Skill"}
                        </Button>
                      ) : (
                        <p className="font-body text-[10px] text-text-muted">
                          No OpenAPI spec available. Add a spec URL in NyxID to enable generation.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          title="Delete System Skill"
          onClose={() => setDeleteTarget(null)}
        >
          <p className="font-body text-sm text-text-muted mb-4">
            Delete the generated skill for <strong className="text-text-primary">{deleteTarget.serviceName}</strong>?
            The service will remain in NyxID. You can regenerate the skill later.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteMutation.mutate(deleteTarget.serviceId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
