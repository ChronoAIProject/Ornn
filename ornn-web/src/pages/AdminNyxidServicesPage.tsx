/**
 * Admin NyxID Services Page.
 * Lists all platform services from NyxID with system skill generation controls.
 * @module pages/AdminNyxidServicesPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import {
  getSystemSkills,
  generateSystemSkill,
  regenerateSystemSkill,
  deleteSystemSkill,
  type SystemSkillItem,
} from "@/services/systemSkillsApi";
import { useToastStore } from "@/stores/toastStore";

export function AdminNyxidServicesPage() {
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
      addToast({ type: "success", message: `Skill "${data.name}" generated` });
      queryClient.invalidateQueries({ queryKey: ["admin", "system-skills"] });
      queryClient.invalidateQueries({ queryKey: ["system-skills-public"] });
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
      addToast({ type: "success", message: `Skill "${data.name}" regenerated` });
      queryClient.invalidateQueries({ queryKey: ["admin", "system-skills"] });
      queryClient.invalidateQueries({ queryKey: ["system-skills-public"] });
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
      queryClient.invalidateQueries({ queryKey: ["system-skills-public"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: `Delete failed: ${err.message}` });
    },
  });

  return (
    <PageTransition>
      <div className="py-4 h-full flex flex-col">
        <div className="mb-4">
          <h1 className="font-heading text-xl tracking-wider text-text-primary">Admin NyxID Services</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            All platform services from NyxID. Generate system skills from OpenAPI specs.
            {items ? ` ${items.length} services found.` : ""}
          </p>
        </div>

        {isLoading ? (
          <Skeleton lines={8} />
        ) : !items?.length ? (
          <EmptyState
            title="No services found"
            description="No services registered in NyxID."
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-neon-cyan/10">
            <table className="w-full">
              <thead className="sticky top-0 bg-bg-elevated/95 backdrop-blur-sm">
                <tr className="border-b border-neon-cyan/10">
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Service</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Category</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Spec</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Skill</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isGenerating = generatingServiceId === item.serviceId;

                  return (
                    <tr key={item.serviceId} className="border-b border-neon-cyan/5 hover:bg-bg-elevated/30 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-mono text-sm font-semibold text-neon-cyan">{item.serviceName}</span>
                          {item.serviceDescription && (
                            <p className="font-body text-xs text-text-muted mt-0.5 truncate max-w-xs">{item.serviceDescription}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="yellow">{item.serviceCategory}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={item.hasOpenApiSpec ? "green" : "muted"}>
                          {item.hasOpenApiSpec ? "available" : "none"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {item.skillGenerated && item.skill ? (
                          <div className="flex items-center gap-2">
                            <Badge color="green">generated</Badge>
                            <button
                              onClick={() => navigate(`/skills/${item.skill!.name}`)}
                              className="font-mono text-xs text-neon-cyan hover:underline cursor-pointer"
                            >
                              {item.skill.name}
                            </button>
                          </div>
                        ) : (
                          <span className="font-body text-xs text-text-muted italic">not generated</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {item.skillGenerated ? (
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
                                onClick={() => setDeleteTarget(item)}
                              >
                                Delete
                              </Button>
                            </>
                          ) : item.hasOpenApiSpec ? (
                            <Button
                              size="sm"
                              onClick={() => generateMutation.mutate(item.serviceId)}
                              disabled={isGenerating}
                            >
                              {isGenerating ? "Generating..." : "Generate"}
                            </Button>
                          ) : (
                            <span className="font-body text-[10px] text-text-muted">No spec</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {deleteTarget && (
          <Modal
            isOpen={!!deleteTarget}
            title="Delete System Skill"
            onClose={() => setDeleteTarget(null)}
          >
            <p className="font-body text-sm text-text-muted mb-4">
              Delete the generated skill for <strong className="text-text-primary">{deleteTarget.serviceName}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
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
    </PageTransition>
  );
}
