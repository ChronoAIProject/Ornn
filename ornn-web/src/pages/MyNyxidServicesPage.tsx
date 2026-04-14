/**
 * My NyxID Services Page.
 * Shows all NyxID services the user has added (from user-services endpoint),
 * enriched with service metadata from proxy/services.
 * @module pages/MyNyxidServicesPage
 */

import { useState, useEffect } from "react";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

interface UserServiceDisplay {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  serviceCategory: string;
  isActive: boolean;
  credentialSource: string;
  proxyUrl: string;
  hasSpec: boolean;
}

export function MyNyxidServicesPage() {
  const [services, setServices] = useState<UserServiceDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch both endpoints in parallel
    Promise.all([
      fetch(`${NYXID_API_BASE}/api/v1/user-services`, { headers }).then((r) => r.ok ? r.json() : { services: [] }),
      fetch(`${NYXID_API_BASE}/api/v1/proxy/services?per_page=100`, { headers }).then((r) => r.ok ? r.json() : { services: [] }),
    ])
      .then(([userSvcData, proxySvcData]) => {
        const userServices = userSvcData.services ?? [];
        const proxyServices = proxySvcData.services ?? [];

        // Build lookup from proxy services by slug
        const proxyBySlug = new Map<string, any>();
        for (const ps of proxyServices) {
          proxyBySlug.set(ps.slug, ps);
        }

        // Map user services, enrich with proxy service metadata
        const display: UserServiceDisplay[] = userServices.map((us: any) => {
          // user-service slug format might be "service-slug-xxxx" or match proxy slug
          const baseSlug = us.slug?.replace(/-[a-z0-9]{4}$/, "") ?? "";
          const proxy = proxyBySlug.get(baseSlug) || proxyBySlug.get(us.slug) || null;

          return {
            id: us.id,
            slug: us.slug,
            name: proxy?.name ?? us.slug ?? "Unknown",
            description: proxy?.description ?? null,
            serviceCategory: proxy?.service_category ?? "unknown",
            isActive: us.is_active ?? false,
            credentialSource: typeof us.credential_source === "object"
              ? us.credential_source?.type ?? "unknown"
              : String(us.credential_source ?? "personal"),
            proxyUrl: proxy?.proxy_url_slug?.replace("/{path}", "") ?? "",
            hasSpec: !!proxy?.openapi_url,
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

  return (
    <PageTransition>
      <div className="py-4">
        <div className="mb-4">
          <h1 className="font-heading text-xl tracking-wider text-text-primary">My NyxID Services</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            Your AI services on NyxID ({services.length} connected)
          </p>
        </div>

        {isLoading ? (
          <p className="font-body text-sm text-text-muted">Loading...</p>
        ) : error ? (
          <p className="font-body text-sm text-neon-red">Failed to load services: {error}</p>
        ) : services.length === 0 ? (
          <EmptyState
            title="No services connected"
            description="Add services in NyxID to see them here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neon-cyan/10">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neon-cyan/10 bg-bg-elevated/50">
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Service</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Category</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Source</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Spec</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => (
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
                      <span className="font-mono text-xs text-text-muted">{svc.credentialSource}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={svc.hasSpec ? "green" : "muted"}>
                        {svc.hasSpec ? "available" : "none"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={svc.isActive ? "green" : "muted"}>
                        {svc.isActive ? "active" : "inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
