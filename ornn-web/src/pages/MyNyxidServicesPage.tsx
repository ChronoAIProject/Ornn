/**
 * My NyxID Services Page.
 * Shows user's own (manually added) AI services from NyxID.
 * Filters out auto-connected services. Allows skill generation.
 * @module pages/MyNyxidServicesPage
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  generateSystemSkill,
  regenerateSystemSkill,
  deleteSystemSkill,
  getPublicSystemSkills,
} from "@/services/systemSkillsApi";

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

interface UserServiceDisplay {
  id: string;
  serviceId: string;
  slug: string;
  name: string;
  description: string | null;
  serviceCategory: string;
  isActive: boolean;
  credentialSource: string;
  hasSpec: boolean;
  openApiUrl: string | null;
  skillGenerated: boolean;
  skillName: string | null;
  skillGuid: string | null;
}

export function MyNyxidServicesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [services, setServices] = useState<UserServiceDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    Promise.all([
      fetch(`${NYXID_API_BASE}/api/v1/user-services`, { headers }).then((r) => r.ok ? r.json() : { services: [] }),
      fetch(`${NYXID_API_BASE}/api/v1/proxy/services?per_page=100`, { headers }).then((r) => r.ok ? r.json() : { services: [] }),
      getPublicSystemSkills().catch(() => ({ items: [] })),
    ])
      .then(([userSvcData, proxySvcData, systemSkillsData]) => {
        const userServices = userSvcData.services ?? [];
        const proxyServices = proxySvcData.services ?? [];
        const systemSkills = systemSkillsData?.items ?? [];

        // Build lookups
        const proxyBySlug = new Map<string, any>();
        for (const ps of proxyServices) {
          proxyBySlug.set(ps.slug, ps);
        }
        const skillByServiceId = new Map<string, any>();
        for (const sk of systemSkills) {
          if (sk.nyxidServiceId) skillByServiceId.set(sk.nyxidServiceId, sk);
        }

        // Filter: only user's own services (not auto-connected)
        // Auto-connected services have requires_connection=false on the proxy service
        // (admin set them up, users don't need to provide credentials)
        const display: UserServiceDisplay[] = userServices
          .filter((us: any) => {
            const baseSlug = us.slug?.replace(/-[a-z0-9]{4}$/, "") ?? "";
            const proxy = proxyBySlug.get(baseSlug) || proxyBySlug.get(us.slug);
            // Keep only services that require user connection (user manually added)
            return proxy?.requires_connection === true;
          })
          .map((us: any) => {
            const baseSlug = us.slug?.replace(/-[a-z0-9]{4}$/, "") ?? "";
            const proxy = proxyBySlug.get(baseSlug) || proxyBySlug.get(us.slug) || null;
            const proxyId = proxy?.id ?? "";
            const skill = skillByServiceId.get(proxyId);

            return {
              id: us.id,
              serviceId: proxyId,
              slug: us.slug,
              name: proxy?.name ?? us.slug ?? "Unknown",
              description: proxy?.description ?? null,
              serviceCategory: proxy?.service_category ?? "unknown",
              isActive: us.is_active ?? false,
              credentialSource: typeof us.credential_source === "object"
                ? us.credential_source?.type ?? "unknown"
                : String(us.credential_source ?? "personal"),
              hasSpec: !!proxy?.openapi_url,
              openApiUrl: proxy?.openapi_url ?? null,
              skillGenerated: !!skill,
              skillName: skill?.name ?? null,
              skillGuid: skill?.guid ?? null,
            };
          });

        setServices(display);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[MyNyxidServices]", err);
        setError(err.message);
        setIsLoading(false);
      });
  }, [accessToken]);

  const generateMutation = useMutation({
    mutationFn: (serviceId: string) => generateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" generated` });
      queryClient.invalidateQueries({ queryKey: ["system-skills-public"] });
      // Refresh the page data
      setGeneratingId(null);
      window.location.reload();
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
      setGeneratingId(null);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (serviceId: string) => regenerateSystemSkill(serviceId),
    onMutate: (serviceId) => setGeneratingId(serviceId),
    onSuccess: (data) => {
      addToast({ type: "success", message: `Skill "${data.name}" regenerated` });
      setGeneratingId(null);
      window.location.reload();
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
      setGeneratingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (serviceId: string) => deleteSystemSkill(serviceId),
    onSuccess: () => {
      addToast({ type: "success", message: "Skill deleted" });
      window.location.reload();
    },
    onError: (err: Error) => {
      addToast({ type: "error", message: err.message });
    },
  });

  return (
    <PageTransition>
      <div className="py-4 h-full flex flex-col">
        <div className="mb-4 shrink-0">
          <h1 className="font-heading text-xl tracking-wider text-text-primary">My NyxID Services</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            Your manually added AI services ({services.length})
          </p>
        </div>

        {isLoading ? (
          <p className="font-body text-sm text-text-muted">Loading...</p>
        ) : error ? (
          <p className="font-body text-sm text-neon-red">Failed to load: {error}</p>
        ) : services.length === 0 ? (
          <EmptyState
            title="No services"
            description="Add AI services in NyxID to see them here."
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
                {services.map((svc) => {
                  const isGenerating = generatingId === svc.serviceId;

                  return (
                    <tr key={svc.id} className="border-b border-neon-cyan/5 hover:bg-bg-elevated/30 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-mono text-sm font-semibold text-neon-cyan">{svc.name}</span>
                          {svc.description && (
                            <p className="font-body text-xs text-text-muted mt-0.5 truncate max-w-xs">{svc.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="yellow">{svc.serviceCategory}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={svc.hasSpec ? "green" : "muted"}>
                          {svc.hasSpec ? "available" : "none"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {svc.skillGenerated && svc.skillName ? (
                          <div className="flex items-center gap-2">
                            <Badge color="green">generated</Badge>
                            <button
                              onClick={() => navigate(`/skills/${svc.skillName}`)}
                              className="font-mono text-xs text-neon-cyan hover:underline cursor-pointer"
                            >
                              {svc.skillName}
                            </button>
                          </div>
                        ) : (
                          <span className="font-body text-xs text-text-muted italic">not generated</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {svc.skillGenerated ? (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => regenerateMutation.mutate(svc.serviceId)} disabled={isGenerating}>
                                {isGenerating ? "..." : "Regenerate"}
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(svc.serviceId)}>
                                Delete
                              </Button>
                            </>
                          ) : svc.hasSpec && svc.serviceId ? (
                            <Button size="sm" onClick={() => generateMutation.mutate(svc.serviceId)} disabled={isGenerating}>
                              {isGenerating ? "Generating..." : "Generate Skill"}
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
      </div>
    </PageTransition>
  );
}
