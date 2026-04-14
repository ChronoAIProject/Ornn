/**
 * My NyxID Services Page.
 * Shows NyxID services the current user is connected to.
 * Uses proxy/services endpoint filtered to connected services.
 * @module pages/MyNyxidServicesPage
 */

import { useState, useEffect } from "react";
import { PageTransition } from "@/components/layout/PageTransition";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

interface ProxyService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  service_category: string;
  connected: boolean;
  requires_connection: boolean;
  proxy_url_slug: string;
  openapi_url: string | null;
  streaming_supported: boolean;
}

export function MyNyxidServicesPage() {
  const [services, setServices] = useState<ProxyService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    fetch(`${NYXID_API_BASE}/api/v1/proxy/services?per_page=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // Only show services the user is connected to
        const connected = (data.services ?? []).filter((s: ProxyService) => s.connected);
        setServices(connected);
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
            Services you are connected to on NyxID
          </p>
        </div>

        {isLoading ? (
          <p className="font-body text-sm text-text-muted">Loading...</p>
        ) : error ? (
          <p className="font-body text-sm text-neon-red">Failed to load services: {error}</p>
        ) : services.length === 0 ? (
          <EmptyState
            title="No services connected"
            description="Connect to services in NyxID to see them here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neon-cyan/10">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neon-cyan/10 bg-bg-elevated/50">
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Service</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Category</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Spec</th>
                  <th className="font-heading text-[10px] font-700 tracking-widest uppercase text-text-muted text-left px-4 py-3">Proxy URL</th>
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
                      <Badge color="yellow">{svc.service_category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={svc.openapi_url ? "green" : "muted"}>
                        {svc.openapi_url ? "available" : "none"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-text-muted truncate block max-w-xs">
                        {svc.proxy_url_slug?.replace("/{path}", "") ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="green">connected</Badge>
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
